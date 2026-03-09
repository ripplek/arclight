// packages/backend/src/engine/digest/pipeline.ts
import { db } from '../../db/client.js';
import { feedItems, userPreferences, digests } from '../../db/schema.js';
import { eq, desc, gte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { rankItems, type RankedItem } from './ranking.js';
import { renderDigest, type DigestTier } from './renderer.js';
import { aiEnhanceItems, type EnhancedItem } from './ai-enhance.js';
import { getItemArcMap } from './arc-context.js';
import { getBuzzHighlights } from './buzz-highlights.js';
import { pickSerendipityItem } from './serendipity.js';
import { dedup } from '../dedup.js';
import type { NormalizedItem } from '../normalizer.js';
import { logger } from '../../shared/logger.js';

export interface GenerateOptions {
  tier: DigestTier;
  count?: number;
  date?: string;
  dryRun?: boolean;
}

export interface GenerateResult {
  id: string;
  tier: DigestTier;
  date: string;
  contentMarkdown: string;
  contentHtml: string;
  items: RankedItem[];
  metadata: {
    itemCount: number;
    generatedAt: string;
    pipelineDurationMs: number;
  };
}

/**
 * Generate a digest for a user.
 */
export async function generateDigest(userId: string, options: GenerateOptions): Promise<GenerateResult> {
  const start = Date.now();
  const { tier, dryRun = false } = options;
  const date = options.date || new Date().toISOString().split('T')[0];

  logger.info({ userId, tier, date }, 'Generating digest');

  // 1. Get user preferences
  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .get();

  const topics = (prefs?.topics as { name: string; keywords: string[]; excludeKeywords?: string[]; boost: number }[]) || [];
  const ranking = (prefs?.ranking as Record<string, unknown>) || {};
  const schedule = (prefs?.schedule as Record<string, { count?: number }>) || {};
  const llmConfig = (prefs?.llmConfig as Record<string, unknown>) || {};

  const tierConfig = schedule[tier];
  const itemCount = options.count || tierConfig?.count || getDefaultCount(tier);

  // 2. Query recent items
  const recencyHours = (ranking.recencyHours as number) || 24;
  const since = new Date(Date.now() - recencyHours * 60 * 60 * 1000);

  const items = await db
    .select()
    .from(feedItems)
    .where(gte(feedItems.fetchedAt, since))
    .orderBy(desc(feedItems.publishedAt))
    .limit(500);

  if (items.length === 0) {
    logger.warn({ userId, tier }, 'No items found for digest');
    return {
      id: nanoid(),
      tier,
      date,
      contentMarkdown: `# ${tierEmoji(tier)} ${date}\n\n暂无新内容。`,
      contentHtml: `<h1>${tierEmoji(tier)} ${date}</h1><p>暂无新内容。</p>`,
      items: [],
      metadata: {
        itemCount: 0,
        generatedAt: new Date().toISOString(),
        pipelineDurationMs: Date.now() - start,
      },
    };
  }

  // 2.5. Dedup — remove duplicate items before ranking
  const dedupedItems = dedup(items as unknown as NormalizedItem[], { similarityThreshold: 0.65 });

  // 3. Ranking
  const rankedItems = rankItems(dedupedItems as unknown as Record<string, unknown>[], {
    topics,
    tierWeights: (ranking.tierWeights as Record<string, number>) || { '1': 2.0, '2': 1.5, '3': 1.0, '4': 0.7 },
    recencyHours,
  });

  // 4. Top N
  const topItems = rankedItems.slice(0, itemCount);

  // 5. AI Enhancement (categorize, translate, summarize, context, why-important)
  // Enable AI enhancement if either user preferences or env var configures an LLM
  let enhancedItems: EnhancedItem[] = topItems;
  const llmEnabled =
    (llmConfig.provider && llmConfig.provider !== 'none') ||
    (process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== 'none');

  if (llmEnabled && tier !== 'flash') {
    try {
      enhancedItems = await aiEnhanceItems(topItems, {
        includeWhyImportant: tier === 'daily' || tier === 'deep',
      });
      logger.info(
        { enhanced: enhancedItems.filter((i) => i.enhanced).length, total: enhancedItems.length },
        'AI enhancement applied',
      );
    } catch (err) {
      logger.warn({ error: err }, 'AI enhancement failed, continuing with raw items');
    }
  }

  // 5.5. Inject Arc context (getItemArcMap never throws — returns empty map on error)
  const arcMap = await getItemArcMap(
    enhancedItems.map((i) => i.id),
    userId,
  );

  for (const item of enhancedItems) {
    const arcInfo = arcMap.get(item.id);
    if (arcInfo) {
      item.arcInfo = {
        id: arcInfo.arcId,
        title: arcInfo.arcTitle,
        status: arcInfo.arcStatus,
        summary: arcInfo.arcSummary,
      };
    }
  }

  // 5.75. Lightweight Buzz highlights stub for Daily/Deep digests
  const buzzHighlights = tier === 'daily' || tier === 'deep'
    ? await getBuzzHighlights(userId, { limit: 3, withinHours: 24 })
    : [];

  // 5.8. Serendipity slot for Daily/Deep digests
  const digestItemIds = new Set(topItems.map((i) => i.id));
  const serendipity = tier === 'daily' || tier === 'deep'
    ? pickSerendipityItem(rankedItems, digestItemIds)
    : null;

  // 6. Render
  const { markdown, html } = renderDigest(enhancedItems, tier, date, { buzzHighlights, serendipity });

  // 7. Store
  const arcIds = [
    ...new Set(enhancedItems.map((item) => item.arcInfo?.id).filter((id): id is string => Boolean(id))),
  ];

  const digestId = nanoid();
  if (!dryRun) {
    await db.insert(digests).values({
      id: digestId,
      userId,
      tier,
      date,
      contentMarkdown: markdown,
      contentHtml: html,
      itemIds: topItems.map((i) => i.id),
      arcIds,
      metadata: {
        itemCount: topItems.length,
        generatedAt: new Date().toISOString(),
        pipelineDurationMs: Date.now() - start,
      },
      createdAt: new Date(),
      pushStatus: 'pending',
    });
    logger.info({ digestId, tier, items: topItems.length, durationMs: Date.now() - start }, 'Digest generated');
  }

  return {
    id: digestId,
    tier,
    date,
    contentMarkdown: markdown,
    contentHtml: html,
    items: topItems,
    metadata: {
      itemCount: topItems.length,
      generatedAt: new Date().toISOString(),
      pipelineDurationMs: Date.now() - start,
    },
  };
}

function getDefaultCount(tier: DigestTier): number {
  switch (tier) {
    case 'flash': return 8;
    case 'daily': return 8;
    case 'deep': return 2;
    default: return 8;
  }
}

function tierEmoji(tier: DigestTier): string {
  switch (tier) {
    case 'flash': return '⚡';
    case 'daily': return '📰';
    case 'deep': return '🔍';
    default: return '📰';
  }
}

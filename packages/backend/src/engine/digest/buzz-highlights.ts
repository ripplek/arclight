import { db } from '../../db/client.js';
import { storyArcs } from '../../db/schema.js';
import { and, desc, eq, gte } from 'drizzle-orm';
import { logger } from '../../shared/logger.js';
import { hasRequiredColumns } from './schema-compat.js';

export interface BuzzHighlight {
  arcId: string;
  title: string;
  summary: string | null;
  buzzScore: number;
  itemCount: number;
  sourceCount: number;
  lastUpdated: Date | null;
}

interface BuzzHighlightOptions {
  limit?: number;
  withinHours?: number;
}

const STORY_ARC_BUZZ_COLUMNS = [
  'id',
  'user_id',
  'title',
  'summary',
  'status',
  'last_updated',
  'item_count',
  'source_count',
  'buzz_score',
] as const;

/**
 * Lightweight buzz stub for Daily/Deep digest.
 *
 * On legacy SQLite schemas (for example missing buzz_score/source_count columns),
 * degrade to [] so digest generation keeps working.
 */
export async function getBuzzHighlights(
  userId: string,
  options: BuzzHighlightOptions = {},
): Promise<BuzzHighlight[]> {
  const limit = options.limit ?? 3;
  const withinHours = options.withinHours ?? 24;

  if (limit <= 0) {
    return [];
  }

  if (!hasRequiredColumns('story_arcs', [...STORY_ARC_BUZZ_COLUMNS])) {
    logger.info({ userId }, 'Buzz highlights skipped: legacy story_arcs schema detected');
    return [];
  }

  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);

  try {
    const rows = await db
      .select({
        arcId: storyArcs.id,
        title: storyArcs.title,
        summary: storyArcs.summary,
        buzzScore: storyArcs.buzzScore,
        itemCount: storyArcs.itemCount,
        sourceCount: storyArcs.sourceCount,
        lastUpdated: storyArcs.lastUpdated,
      })
      .from(storyArcs)
      .where(
        and(
          eq(storyArcs.userId, userId),
          eq(storyArcs.status, 'active'),
          gte(storyArcs.lastUpdated, cutoff),
        ),
      )
      .orderBy(desc(storyArcs.buzzScore), desc(storyArcs.lastUpdated))
      .limit(limit);

    return rows
      .filter((row) => row.title?.trim())
      .map((row) => ({
        arcId: row.arcId,
        title: row.title.trim(),
        summary: row.summary?.trim() || null,
        buzzScore: row.buzzScore ?? 0,
        itemCount: row.itemCount ?? 0,
        sourceCount: row.sourceCount ?? 0,
        lastUpdated: row.lastUpdated ?? null,
      }));
  } catch (err) {
    logger.warn({ err, userId, limit, withinHours }, 'Failed to load buzz highlights, falling back to empty');
    return [];
  }
}

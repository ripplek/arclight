// packages/backend/src/engine/store.ts
import { db } from '../db/client.js';
import { feedItems, feedSources, userSources } from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { NormalizedItem } from './normalizer.js';
import type { FetchResult } from './fetch-manager.js';
import { logger } from '../shared/logger.js';
import { processItemForArc } from './arc/index.js';
import { BuzzDetector } from './arc/buzz-detector.js';

/**
 * 写入新的 feed items 到数据库。
 * 先查询已有的 dedupHash，跳过已存在的。
 */
export async function storeItems(items: NormalizedItem[]): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };

  const hashes = items.map((i) => i.dedupHash);
  const existing = await db
    .select({ hash: feedItems.dedupHash })
    .from(feedItems)
    .where(inArray(feedItems.dedupHash, hashes));

  const existingSet = new Set(existing.map((e) => e.hash));
  const newItems = items.filter((i) => !existingSet.has(i.dedupHash));

  if (newItems.length === 0) {
    return { inserted: 0, skipped: items.length };
  }

  const BATCH_SIZE = 50;
  let inserted = 0;

  for (let i = 0; i < newItems.length; i += BATCH_SIZE) {
    const batch = newItems.slice(i, i + BATCH_SIZE);
    await db.insert(feedItems).values(
      batch.map((item) => ({
        id: item.id,
        sourceId: item.sourceId,
        externalId: item.externalId,
        url: item.url,
        title: item.title,
        content: item.content,
        author: item.author,
        language: item.language,
        tier: item.tier,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        entities: item.entities,
        tags: item.tags,
        dedupHash: item.dedupHash,
        createdAt: new Date(),
      })),
    );
    inserted += batch.length;
  }

  const affectedUserIds = await processInsertedItemsForArcs(newItems);
  await runBuzzDetection(affectedUserIds);
  logger.info({ inserted, skipped: items.length - newItems.length }, 'Items stored');
  return { inserted, skipped: items.length - newItems.length };
}

async function processInsertedItemsForArcs(items: NormalizedItem[]): Promise<Set<string>> {
  const affectedUserIds = new Set<string>();

  for (const item of items) {
    // Only process for users who subscribe to this item's source
    const subscribers = await db
      .selectDistinct({ userId: userSources.userId })
      .from(userSources)
      .where(and(eq(userSources.sourceId, item.sourceId), eq(userSources.enabled, true)));

    for (const sub of subscribers) {
      affectedUserIds.add(sub.userId);
      try {
        await processItemForArc(item, sub.userId);
      } catch (error) {
        logger.warn(
          { error, itemId: item.id, userId: sub.userId },
          'Arc processing failed for item; continuing fetch pipeline',
        );
      }
    }
  }

  return affectedUserIds;
}

/**
 * Run BuzzDetector for each affected user after items are inserted and arcs processed.
 * Performance budget: <200ms per user (single DB query + in-memory scoring).
 * Exceptions are caught and warned — never breaks the main pipeline.
 */
async function runBuzzDetection(userIds: Set<string>): Promise<void> {
  if (userIds.size === 0) return;

  for (const userId of userIds) {
    const start = Date.now();
    try {
      const detector = new BuzzDetector(userId);
      const results = await detector.detect();
      const elapsed = Date.now() - start;

      if (results.length > 0) {
        logger.info(
          { userId, buzzCount: results.length, elapsedMs: elapsed },
          'Buzz detection completed',
        );

        // TODO [C2]: If buzz detected with no matching active Arc, consider
        // auto-creating an Arc. This could reuse CandidatePool logic by
        // injecting buzz item IDs as candidates, or directly create a new Arc
        // from BuzzResult. Deferred to avoid complexity — current behavior
        // only back-fills buzzScore on existing Arcs.
      }

      if (elapsed > 200) {
        logger.warn(
          { userId, elapsedMs: elapsed },
          'Buzz detection exceeded 200ms budget',
        );
      }
    } catch (err) {
      logger.warn(
        { err, userId },
        'Buzz detection failed for user — skipping without affecting pipeline',
      );
    }
  }
}

/** Update source fetch status after a fetch attempt */
export async function updateSourceStatus(result: FetchResult): Promise<void> {
  if (result.status === 'ok') {
    await db
      .update(feedSources)
      .set({
        lastFetchedAt: new Date(),
        lastFetchStatus: 'ok',
        fetchErrorCount: 0,
      })
      .where(eq(feedSources.id, result.source.id));
  } else {
    await db
      .update(feedSources)
      .set({
        lastFetchStatus: 'error',
        fetchErrorCount: sql`${feedSources.fetchErrorCount} + 1`,
      })
      .where(eq(feedSources.id, result.source.id));
  }
}

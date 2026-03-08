// packages/backend/src/engine/store.ts
import { db } from '../db/client.js';
import { feedItems, feedSources, users } from '../db/schema.js';
import { eq, inArray, sql } from 'drizzle-orm';
import type { NormalizedItem } from './normalizer.js';
import type { FetchResult } from './fetch-manager.js';
import { logger } from '../shared/logger.js';
import { processItemForArc } from './arc/index.js';

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

  await processInsertedItemsForArcs(newItems);
  logger.info({ inserted, skipped: items.length - newItems.length }, 'Items stored');
  return { inserted, skipped: items.length - newItems.length };
}

async function processInsertedItemsForArcs(items: NormalizedItem[]): Promise<void> {
  const allUsers = await db.select({ id: users.id }).from(users);
  if (allUsers.length === 0) return;

  for (const item of items) {
    for (const user of allUsers) {
      try {
        await processItemForArc(item, user.id);
      } catch (error) {
        logger.warn(
          { error, itemId: item.id, userId: user.id },
          'Arc processing failed for item; continuing fetch pipeline',
        );
      }
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

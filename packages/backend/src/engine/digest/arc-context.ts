import { db } from '../../db/client.js';
import { arcItems, storyArcs } from '../../db/schema.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ArcStatus } from '../arc/types.js';
import { logger } from '../../shared/logger.js';

export interface ItemArcInfo {
  arcId: string;
  arcTitle: string;
  arcStatus: ArcStatus;
  arcSummary: string | null;
}

/**
 * Build a mapping from itemId -> Arc info for digest items.
 * Returns empty map on any error (graceful degradation).
 */
export async function getItemArcMap(
  itemIds: string[],
  userId: string,
): Promise<Map<string, ItemArcInfo>> {
  if (itemIds.length === 0) {
    return new Map();
  }

  try {
    const uniqueItemIds = [...new Set(itemIds)];

    // Single JOIN query scoped to userId — avoids fetching cross-user arc links
    // ORDER BY buzzScore DESC ensures deterministic arc selection (highest buzz wins)
    const rows = await db
      .select({
        itemId: arcItems.itemId,
        arcId: storyArcs.id,
        title: storyArcs.title,
        status: storyArcs.status,
        summary: storyArcs.summary,
        buzzScore: storyArcs.buzzScore,
      })
      .from(arcItems)
      .innerJoin(storyArcs, eq(arcItems.arcId, storyArcs.id))
      .where(
        and(
          inArray(arcItems.itemId, uniqueItemIds),
          eq(storyArcs.userId, userId),
          inArray(storyArcs.status, ['active', 'stale']),
        ),
      )
      .orderBy(desc(storyArcs.buzzScore));

    if (rows.length === 0) {
      return new Map();
    }

    // First-wins: highest buzzScore arc is kept per item (deterministic due to ORDER BY)
    const itemArcMap = new Map<string, ItemArcInfo>();
    for (const row of rows) {
      if (!itemArcMap.has(row.itemId)) {
        itemArcMap.set(row.itemId, {
          arcId: row.arcId,
          arcTitle: row.title,
          arcStatus: row.status as ArcStatus,
          arcSummary: row.summary,
        });
      }
    }

    return itemArcMap;
  } catch (err) {
    logger.warn({ error: err, userId, itemCount: itemIds.length }, 'Failed to resolve item arc context');
    return new Map();
  }
}

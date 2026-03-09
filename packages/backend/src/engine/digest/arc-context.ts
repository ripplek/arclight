import { db } from '../../db/client.js';
import { arcItems, storyArcs } from '../../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
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

    const itemArcLinks = await db
      .select({
        itemId: arcItems.itemId,
        arcId: arcItems.arcId,
      })
      .from(arcItems)
      .where(inArray(arcItems.itemId, uniqueItemIds));

    if (itemArcLinks.length === 0) {
      return new Map();
    }

    const uniqueArcIds = [...new Set(itemArcLinks.map((link) => link.arcId))];
    const arcs = await db
      .select({
        id: storyArcs.id,
        title: storyArcs.title,
        status: storyArcs.status,
        summary: storyArcs.summary,
      })
      .from(storyArcs)
      .where(
        and(
          inArray(storyArcs.id, uniqueArcIds),
          eq(storyArcs.userId, userId),
          inArray(storyArcs.status, ['active', 'stale']),
        ),
      );

    if (arcs.length === 0) {
      return new Map();
    }

    const arcById = new Map<string, ItemArcInfo>(
      arcs.map((arc) => [
        arc.id,
        {
          arcId: arc.id,
          arcTitle: arc.title,
          arcStatus: arc.status as ArcStatus,
          arcSummary: arc.summary,
        },
      ]),
    );

    const itemArcMap = new Map<string, ItemArcInfo>();
    for (const link of itemArcLinks) {
      const arcInfo = arcById.get(link.arcId);
      if (arcInfo && !itemArcMap.has(link.itemId)) {
        itemArcMap.set(link.itemId, arcInfo);
      }
    }

    return itemArcMap;
  } catch (err) {
    logger.warn({ error: err, userId, itemCount: itemIds.length }, 'Failed to resolve item arc context');
    return new Map();
  }
}

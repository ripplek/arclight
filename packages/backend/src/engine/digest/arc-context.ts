import { db, sqliteAll } from '../../db/client.js';
import { arcItems, storyArcs } from '../../db/schema.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ArcStatus } from '../arc/types.js';
import { logger } from '../../shared/logger.js';
import { hasRequiredColumns } from './schema-compat.js';

export interface ItemArcInfo {
  arcId: string;
  arcTitle: string;
  arcStatus: ArcStatus;
  arcSummary: string | null;
}

const STORY_ARC_CONTEXT_COLUMNS = ['id', 'user_id', 'title', 'summary', 'status', 'buzz_score'] as const;
const ARC_ITEM_CONTEXT_COLUMNS = ['arc_id', 'item_id'] as const;

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

  // Pre-check: skip entirely if legacy schema detected
  if (
    !hasRequiredColumns('story_arcs', [...STORY_ARC_CONTEXT_COLUMNS]) ||
    !hasRequiredColumns('arc_items', [...ARC_ITEM_CONTEXT_COLUMNS])
  ) {
    logger.info({ userId }, 'Arc context skipped: legacy story_arcs/arc_items schema detected');
    return new Map();
  }

  const uniqueItemIds = [...new Set(itemIds)];

  try {
    // Primary path for the latest schema.
    // ORDER BY buzzScore DESC ensures deterministic arc selection (highest buzz wins).
    const rows = await db
      .select({
        itemId: arcItems.itemId,
        arcId: storyArcs.id,
        title: storyArcs.title,
        status: storyArcs.status,
        summary: storyArcs.summary,
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

    return buildItemArcMap(rows);
  } catch (err) {
    logger.warn({ error: err, userId, itemCount: itemIds.length }, 'Failed to resolve item arc context');
    return new Map();
  }
}

function buildItemArcMap(
  rows: Array<{
    itemId: string;
    arcId: string;
    title: string;
    status: string;
    summary: string | null;
  }>,
): Map<string, ItemArcInfo> {
  // First-wins: query ORDER BY decides which arc survives per item.
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
}

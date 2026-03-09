import { db, sqliteAll } from '../../db/client.js';
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

  const uniqueItemIds = [...new Set(itemIds)];

  try {
    let rows: Array<{
      itemId: string;
      arcId: string;
      title: string;
      status: string;
      summary: string | null;
    }>;

    try {
      // Primary path for the latest schema.
      // ORDER BY buzzScore DESC ensures deterministic arc selection (highest buzz wins).
      rows = await db
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
    } catch (err) {
      if (!isMissingBuzzScoreColumnError(err)) {
        throw err;
      }

      logger.info({ userId }, 'Arc context query falling back to legacy story_arcs schema');
      rows = getLegacyItemArcRows(uniqueItemIds, userId);
    }

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

function getLegacyItemArcRows(
  itemIds: string[],
  userId: string,
): Array<{
  itemId: string;
  arcId: string;
  title: string;
  status: string;
  summary: string | null;
}> {
  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = sqliteAll<{
    itemId: string;
    arcId: string;
    title: string;
    status: string;
    summary: string | null;
  }>(
    `
      SELECT
        arc_items.item_id AS itemId,
        story_arcs.id AS arcId,
        story_arcs.title AS title,
        story_arcs.status AS status,
        story_arcs.summary AS summary
      FROM arc_items
      INNER JOIN story_arcs ON arc_items.arc_id = story_arcs.id
      WHERE arc_items.item_id IN (${placeholders})
        AND story_arcs.user_id = ?
        AND story_arcs.status IN ('active', 'stale')
      ORDER BY story_arcs.last_updated DESC, story_arcs.item_count DESC, story_arcs.id ASC
    `,
    ...itemIds,
    userId,
  );

  return rows;
}

function isMissingBuzzScoreColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const sqliteError = err as { code?: string; message?: string };
  return sqliteError.code === 'SQLITE_ERROR'
    && typeof sqliteError.message === 'string'
    && sqliteError.message.includes('story_arcs.buzz_score');
}

import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { arcItems, buzzEvents, storyArcs } from '../../db/schema.js';
import { logger } from '../../shared/logger.js';
import { ARC_CONFIG } from './types.js';
import { getArcSnapshotCache } from './matcher.js';

export async function updateArcStatuses(): Promise<{ staleCount: number; archivedCount: number }> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - ARC_CONFIG.activeToStaleMs);
  const archivedCutoff = new Date(now.getTime() - ARC_CONFIG.staleToArchivedMs);

  const staleResult = await db
    .update(storyArcs)
    .set({
      status: 'stale',
      updatedAt: now,
    })
    .where(
      and(
        eq(storyArcs.status, 'active'),
        isNull(storyArcs.mergedIntoId),
        lt(storyArcs.lastUpdated, staleCutoff),
      ),
    );

  const archivedResult = await db
    .update(storyArcs)
    .set({
      status: 'archived',
      updatedAt: now,
    })
    .where(
      and(
        eq(storyArcs.status, 'stale'),
        lt(storyArcs.lastUpdated, archivedCutoff),
      ),
    );

  // Keep cache strict: stale/archived arcs should not stay in active cache.
  const cache = getArcSnapshotCache();
  const staleChanged = Number((staleResult as { changes?: number }).changes ?? 0);
  const archivedChanged = Number((archivedResult as { changes?: number }).changes ?? 0);
  if (staleChanged > 0 || archivedChanged > 0) {
    await cache.refresh(true);
  }

  logger.info({ staleChanged, archivedChanged }, 'Arc lifecycle status update complete');
  return {
    staleCount: staleChanged,
    archivedCount: archivedChanged,
  };
}

export async function cleanupOldArcs(): Promise<{ deletedCount: number }> {
  const retentionCutoff = new Date(Date.now() - ARC_CONFIG.archivedRetentionMs);

  const oldArcs = await db
    .select({
      id: storyArcs.id,
      userId: storyArcs.userId,
    })
    .from(storyArcs)
    .where(
      and(
        eq(storyArcs.status, 'archived'),
        lt(storyArcs.updatedAt, retentionCutoff),
      ),
    );

  if (oldArcs.length === 0) {
    return { deletedCount: 0 };
  }

  const ids = oldArcs.map((arc) => arc.id);

  await db.delete(arcItems).where(inArray(arcItems.arcId, ids));
  await db.delete(buzzEvents).where(inArray(buzzEvents.arcId, ids));
  const deleteResult = await db.delete(storyArcs).where(inArray(storyArcs.id, ids));

  const deletedCount = Number((deleteResult as { changes?: number }).changes ?? ids.length);
  const cache = getArcSnapshotCache();
  for (const arc of oldArcs) {
    cache.remove(arc.userId, arc.id);
  }

  logger.info({ deletedCount }, 'Old archived arcs cleaned');
  return { deletedCount };
}

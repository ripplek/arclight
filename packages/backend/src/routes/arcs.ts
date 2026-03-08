import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { arcItems, feedItems, feedSources, storyArcs } from '../db/schema.js';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';
import { getArcSnapshotCache } from '../engine/arc/matcher.js';
import { getArcStats, mergeTerms, computeBuzzScore } from '../engine/arc/utils.js';

const arcRoutes = new Hono<{ Variables: AuthVariables }>();

arcRoutes.use('*', requireAuth);

const listArcQuerySchema = z.object({
  status: z.enum(['active', 'stale', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

arcRoutes.get('/', zValidator('query', listArcQuerySchema), async (c) => {
  const user = c.get('user');
  const { status, limit, offset } = c.req.valid('query');

  const whereClause = and(
    eq(storyArcs.userId, user.id),
    isNull(storyArcs.mergedIntoId),
    status === 'all'
      ? or(
        eq(storyArcs.status, 'active'),
        eq(storyArcs.status, 'stale'),
        eq(storyArcs.status, 'archived'),
      )
      : eq(storyArcs.status, status),
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(storyArcs)
    .where(whereClause);

  const arcs = await db
    .select()
    .from(storyArcs)
    .where(whereClause)
    .orderBy(desc(storyArcs.lastUpdated))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: arcs,
    pagination: { total, limit, offset },
  });
});

arcRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const arc = await db
    .select()
    .from(storyArcs)
    .where(and(eq(storyArcs.id, id), eq(storyArcs.userId, user.id)))
    .get();

  if (!arc) return c.json({ error: 'Arc not found' }, 404);

  const items = await db
    .select({
      arcItemId: arcItems.id,
      itemId: feedItems.id,
      title: feedItems.title,
      headline: arcItems.headline,
      url: feedItems.url,
      sourceId: feedItems.sourceId,
      sourceName: feedSources.name,
      publishedAt: feedItems.publishedAt,
      fetchedAt: feedItems.fetchedAt,
      addedAt: arcItems.addedAt,
      relevanceScore: arcItems.relevanceScore,
      isKeyEvent: arcItems.isKeyEvent,
    })
    .from(arcItems)
    .innerJoin(feedItems, eq(arcItems.itemId, feedItems.id))
    .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
    .where(eq(arcItems.arcId, id))
    .orderBy(asc(arcItems.addedAt));

  return c.json({
    data: {
      arc,
      items,
    },
  });
});

const patchArcSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    status: z.enum(['active', 'stale', 'archived']).optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'No update fields provided',
  });

arcRoutes.patch('/:id', zValidator('json', patchArcSchema), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const payload = c.req.valid('json');

  const existing = await db
    .select({ id: storyArcs.id })
    .from(storyArcs)
    .where(and(eq(storyArcs.id, id), eq(storyArcs.userId, user.id)))
    .get();

  if (!existing) return c.json({ error: 'Arc not found' }, 404);

  await db
    .update(storyArcs)
    .set({
      ...payload,
      ...(payload.title ? { titleSource: 'user' as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(storyArcs.id, id));

  const updated = await db.select().from(storyArcs).where(eq(storyArcs.id, id)).get();
  if (updated) {
    if (updated.status === 'active') {
      getArcSnapshotCache().upsert({
        id: updated.id,
        userId: updated.userId,
        title: updated.title,
        entities: updated.entities ?? [],
        keywords: updated.keywords ?? [],
        lastItemAt: updated.lastUpdated ? new Date(updated.lastUpdated).getTime() : Date.now(),
      });
    } else {
      getArcSnapshotCache().remove(updated.userId, updated.id);
    }
  }

  return c.json({ data: updated });
});

arcRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const existing = await db
    .select({ id: storyArcs.id })
    .from(storyArcs)
    .where(and(eq(storyArcs.id, id), eq(storyArcs.userId, user.id)))
    .get();

  if (!existing) return c.json({ error: 'Arc not found' }, 404);

  await db
    .update(storyArcs)
    .set({
      status: 'archived',
      updatedAt: new Date(),
    })
    .where(eq(storyArcs.id, id));

  getArcSnapshotCache().remove(user.id, id);
  return c.json({ ok: true });
});

const mergeArcSchema = z.object({
  sourceArcId: z.string().min(1),
});

arcRoutes.post('/:id/merge', zValidator('json', mergeArcSchema), async (c) => {
  const user = c.get('user');
  const targetArcId = c.req.param('id');
  const { sourceArcId } = c.req.valid('json');

  if (sourceArcId === targetArcId) {
    return c.json({ error: 'Cannot merge an arc into itself' }, 400);
  }

  const [targetArc, sourceArc] = await Promise.all([
    db
      .select()
      .from(storyArcs)
      .where(and(eq(storyArcs.id, targetArcId), eq(storyArcs.userId, user.id)))
      .get(),
    db
      .select()
      .from(storyArcs)
      .where(and(eq(storyArcs.id, sourceArcId), eq(storyArcs.userId, user.id)))
      .get(),
  ]);

  if (!targetArc || !sourceArc) {
    return c.json({ error: 'Arc not found' }, 404);
  }

  if (sourceArc.mergedIntoId) {
    return c.json({ error: 'Source arc has already been merged' }, 409);
  }

  if (targetArc.mergedIntoId) {
    return c.json({ error: 'Target arc has already been merged into another arc' }, 409);
  }

  const sourceItems = await db
    .select()
    .from(arcItems)
    .where(eq(arcItems.arcId, sourceArcId));

  if (sourceItems.length > 0) {
    await db.insert(arcItems).values(
      sourceItems.map((item) => ({
        id: nanoid(),
        arcId: targetArcId,
        itemId: item.itemId,
        relevanceScore: item.relevanceScore,
        isKeyEvent: item.isKeyEvent,
        headline: item.headline,
        addedAt: item.addedAt,
      })),
    ).onConflictDoNothing({
      target: [arcItems.arcId, arcItems.itemId],
    });
  }

  await db
    .update(storyArcs)
    .set({
      status: 'archived',
      mergedIntoId: targetArcId,
      updatedAt: new Date(),
    })
    .where(eq(storyArcs.id, sourceArcId));

  const mergedTimeline = mergeTimeline(targetArc.timeline ?? [], sourceArc.timeline ?? []);
  const mergedEntities = mergeTerms([...(targetArc.entities ?? []), ...(sourceArc.entities ?? [])]);
  const mergedKeywords = mergeTerms([...(targetArc.keywords ?? []), ...(sourceArc.keywords ?? [])]);
  const stats = await getArcStats(targetArcId);

  await db
    .update(storyArcs)
    .set({
      entities: mergedEntities,
      keywords: mergedKeywords,
      timeline: mergedTimeline,
      itemCount: stats.itemCount,
      sourceCount: stats.sourceCount,
      buzzScore: computeBuzzScore(stats.itemCount, stats.sourceCount),
      lastUpdated: maxDate(targetArc.lastUpdated, sourceArc.lastUpdated),
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(storyArcs.id, targetArcId));

  const updatedTarget = await db.select().from(storyArcs).where(eq(storyArcs.id, targetArcId)).get();
  if (updatedTarget) {
    getArcSnapshotCache().upsert({
      id: updatedTarget.id,
      userId: updatedTarget.userId,
      title: updatedTarget.title,
      entities: updatedTarget.entities ?? [],
      keywords: updatedTarget.keywords ?? [],
      lastItemAt: updatedTarget.lastUpdated ? new Date(updatedTarget.lastUpdated).getTime() : Date.now(),
    });
  }
  getArcSnapshotCache().remove(user.id, sourceArcId);

  return c.json({
    data: {
      targetArcId,
      mergedArcId: sourceArcId,
      itemCount: stats.itemCount,
      sourceCount: stats.sourceCount,
    },
  });
});
function mergeTimeline(
  a: { date: string; headline: string; itemId: string }[],
  b: { date: string; headline: string; itemId: string }[],
): { date: string; headline: string; itemId: string }[] {
  const seen = new Set<string>();
  const merged = [...a, ...b].filter((entry) => {
    if (seen.has(entry.itemId)) return false;
    seen.add(entry.itemId);
    return true;
  });
  merged.sort((x, y) => x.date.localeCompare(y.date));
  if (merged.length > 80) return merged.slice(merged.length - 80);
  return merged;
}

function maxDate(a: Date | null, b: Date | null): Date {
  const aTs = a ? new Date(a).getTime() : 0;
  const bTs = b ? new Date(b).getTime() : 0;
  return new Date(Math.max(aTs, bTs, Date.now()));
}

export { arcRoutes };

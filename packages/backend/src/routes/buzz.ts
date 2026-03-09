import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq, and, gte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { buzzEvents, storyArcs } from '../db/schema.js';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';
import { hasRequiredColumns } from '../engine/digest/schema-compat.js';

const buzzRoutes = new Hono<{ Variables: AuthVariables }>();

buzzRoutes.use('*', requireAuth);

// ── Required columns for legacy-safe degradation ──────────────────
const BUZZ_REQUIRED_COLS = ['id', 'user_id', 'entity', 'score', 'event_at', 'arc_id'];
const ARC_REQUIRED_COLS = ['id', 'title', 'user_id'];

function buzzTableReady(): boolean {
  return hasRequiredColumns('buzz_events', BUZZ_REQUIRED_COLS);
}

// ── GET /api/v1/buzz — recent buzz events ─────────────────────────
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  hours: z.coerce.number().min(1).max(168).default(24),
});

buzzRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const user = c.get('user');
  const { limit, hours } = c.req.valid('query');

  if (!buzzTableReady()) {
    return c.json({
      data: [],
      meta: { degraded: true, reason: 'buzz_events table not yet migrated' },
    });
  }

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const arcsAvailable = hasRequiredColumns('story_arcs', ARC_REQUIRED_COLS);

  if (arcsAvailable) {
    const rows = await db
      .select({
        id: buzzEvents.id,
        entity: buzzEvents.entity,
        score: buzzEvents.score,
        velocity: buzzEvents.velocity,
        sourceCount: buzzEvents.sourceCount,
        arcId: buzzEvents.arcId,
        itemId: buzzEvents.itemId,
        sourceId: buzzEvents.sourceId,
        eventAt: buzzEvents.eventAt,
        createdAt: buzzEvents.createdAt,
        arcTitle: storyArcs.title,
        arcStatus: storyArcs.status,
      })
      .from(buzzEvents)
      .leftJoin(storyArcs, eq(buzzEvents.arcId, storyArcs.id))
      .where(
        and(
          eq(buzzEvents.userId, user.id),
          gte(buzzEvents.eventAt, cutoff),
        ),
      )
      .orderBy(desc(buzzEvents.eventAt))
      .limit(limit);

    return c.json({ data: rows });
  }

  // Degraded: no arc join
  const rows = await db
    .select({
      id: buzzEvents.id,
      entity: buzzEvents.entity,
      score: buzzEvents.score,
      velocity: buzzEvents.velocity,
      sourceCount: buzzEvents.sourceCount,
      arcId: buzzEvents.arcId,
      itemId: buzzEvents.itemId,
      sourceId: buzzEvents.sourceId,
      eventAt: buzzEvents.eventAt,
      createdAt: buzzEvents.createdAt,
    })
    .from(buzzEvents)
    .where(
      and(
        eq(buzzEvents.userId, user.id),
        gte(buzzEvents.eventAt, cutoff),
      ),
    )
    .orderBy(desc(buzzEvents.eventAt))
    .limit(limit);

  return c.json({
    data: rows,
    meta: { degraded: true, reason: 'story_arcs table not available for join' },
  });
});

// ── GET /api/v1/buzz/top — top buzz ranking (24h, by score desc) ──
const topQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

buzzRoutes.get('/top', zValidator('query', topQuerySchema), async (c) => {
  const user = c.get('user');
  const { limit } = c.req.valid('query');

  if (!buzzTableReady()) {
    return c.json({
      data: [],
      meta: { degraded: true, reason: 'buzz_events table not yet migrated' },
    });
  }

  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const arcsAvailable = hasRequiredColumns('story_arcs', ARC_REQUIRED_COLS);

  if (arcsAvailable) {
    // Aggregate by entity, pick max score, left join arcs for title
    const rows = await db
      .select({
        entity: buzzEvents.entity,
        maxScore: sql<number>`MAX(${buzzEvents.score})`.as('max_score'),
        totalEvents: sql<number>`COUNT(*)`.as('total_events'),
        avgVelocity: sql<number>`AVG(${buzzEvents.velocity})`.as('avg_velocity'),
        maxSourceCount: sql<number>`MAX(${buzzEvents.sourceCount})`.as('max_source_count'),
        arcId: buzzEvents.arcId,
        arcTitle: storyArcs.title,
      })
      .from(buzzEvents)
      .leftJoin(storyArcs, eq(buzzEvents.arcId, storyArcs.id))
      .where(
        and(
          eq(buzzEvents.userId, user.id),
          gte(buzzEvents.eventAt, cutoff24h),
        ),
      )
      .groupBy(buzzEvents.entity)
      .orderBy(sql`max_score DESC`)
      .limit(limit);

    return c.json({ data: rows });
  }

  // Degraded: no arc join
  const rows = await db
    .select({
      entity: buzzEvents.entity,
      maxScore: sql<number>`MAX(${buzzEvents.score})`.as('max_score'),
      totalEvents: sql<number>`COUNT(*)`.as('total_events'),
      avgVelocity: sql<number>`AVG(${buzzEvents.velocity})`.as('avg_velocity'),
      maxSourceCount: sql<number>`MAX(${buzzEvents.sourceCount})`.as('max_source_count'),
      arcId: buzzEvents.arcId,
    })
    .from(buzzEvents)
    .where(
      and(
        eq(buzzEvents.userId, user.id),
        gte(buzzEvents.eventAt, cutoff24h),
      ),
    )
    .groupBy(buzzEvents.entity)
    .orderBy(sql`max_score DESC`)
    .limit(limit);

  return c.json({
    data: rows,
    meta: { degraded: true, reason: 'story_arcs table not available for join' },
  });
});

export { buzzRoutes };

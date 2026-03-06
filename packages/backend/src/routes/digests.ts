// packages/backend/src/routes/digests.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/client.js';
import { digests } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';
import { generateDigest } from '../engine/digest/pipeline.js';

const digestRoutes = new Hono<{ Variables: AuthVariables }>();

digestRoutes.use('*', requireAuth);

// GET /me/digests — list user's digests
digestRoutes.get('/', async (c) => {
  const user = c.get('user');
  const limit = Number(c.req.query('limit') || '20');

  const results = await db.select().from(digests)
    .where(eq(digests.userId, user.id))
    .orderBy(desc(digests.createdAt))
    .limit(limit);

  return c.json({ digests: results });
});

// GET /me/digests/latest — get latest digest (optionally by tier)
digestRoutes.get('/latest', async (c) => {
  const user = c.get('user');
  const tier = c.req.query('tier') || 'daily';

  const result = await db.select().from(digests)
    .where(and(
      eq(digests.userId, user.id),
      eq(digests.tier, tier as 'flash' | 'daily' | 'deep' | 'weekly' | 'buzz' | 'alert'),
    ))
    .orderBy(desc(digests.createdAt))
    .limit(1)
    .get();

  if (!result) return c.json({ error: 'No digest found' }, 404);
  return c.json(result);
});

// GET /me/digests/:id — get specific digest
digestRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const result = await db.select().from(digests)
    .where(and(eq(digests.id, id), eq(digests.userId, user.id)))
    .get();

  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

// POST /me/digests/generate — manually trigger digest generation
digestRoutes.post('/generate', zValidator('json', z.object({
  tier: z.enum(['flash', 'daily', 'deep']),
  count: z.number().min(1).max(20).optional(),
})), async (c) => {
  const user = c.get('user');
  const { tier, count } = c.req.valid('json');

  const digest = await generateDigest(user.id, {
    tier,
    count: count || undefined,
  });

  return c.json(digest, 201);
});

export { digestRoutes };

// packages/backend/src/routes/engine.ts
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { feedSources, feedItems } from '../db/schema.js';
import { eq, desc, count } from 'drizzle-orm';
import { requireAuth, requireAdmin, type AuthVariables } from '../middleware/auth.js';
import { getScheduler } from '../engine/scheduler.js';
import { FetchManager } from '../engine/fetch-manager.js';
import { normalize } from '../engine/normalizer.js';
import { dedup } from '../engine/dedup.js';
import { storeItems, updateSourceStatus } from '../engine/store.js';

const engineRoutes = new Hono<{ Variables: AuthVariables }>();

engineRoutes.use('*', requireAuth, requireAdmin);

// ── Source health ──
engineRoutes.get('/sources/health', async (c) => {
  const sources = await db
    .select({
      id: feedSources.id,
      name: feedSources.name,
      type: feedSources.type,
      tier: feedSources.tier,
      enabled: feedSources.enabled,
      lastFetchedAt: feedSources.lastFetchedAt,
      lastFetchStatus: feedSources.lastFetchStatus,
      fetchErrorCount: feedSources.fetchErrorCount,
    })
    .from(feedSources)
    .orderBy(desc(feedSources.lastFetchedAt));

  return c.json({ data: sources });
});

// ── Manual full fetch ──
engineRoutes.post('/fetch', async (c) => {
  const scheduler = getScheduler();
  const result = await scheduler.fetchAll();
  return c.json({ data: result });
});

// ── Manual single-source fetch ──
engineRoutes.post('/fetch/:sourceId', async (c) => {
  const sourceId = c.req.param('sourceId');
  const source = await db.select().from(feedSources).where(eq(feedSources.id, sourceId)).get();
  if (!source) return c.json({ error: 'Source not found' }, 404);

  const fm = new FetchManager();
  const results = await fm.fetchBatch([{
    id: source.id,
    url: source.url,
    name: source.name,
    type: source.type,
    tier: source.tier,
    fetchConfig: source.fetchConfig as Record<string, unknown> | undefined,
  }]);

  const result = results[0];
  await updateSourceStatus(result);

  if (result.status === 'ok' && result.items.length > 0) {
    const normalized = normalize(result.items, result.source);
    const deduped = dedup(normalized);
    const storeResult = await storeItems(deduped);
    return c.json({ data: { ...result, stored: storeResult } });
  }

  return c.json({ data: result });
});

// ── Reset circuit breaker ──
engineRoutes.post('/sources/:sourceId/reset', async (c) => {
  const sourceId = c.req.param('sourceId');
  await db
    .update(feedSources)
    .set({ enabled: true, fetchErrorCount: 0, lastFetchStatus: null })
    .where(eq(feedSources.id, sourceId));
  return c.json({ ok: true });
});

// ── Stats ──
engineRoutes.get('/stats', async (c) => {
  const [{ value: totalItems }] = await db.select({ value: count() }).from(feedItems);
  const [{ value: totalSources }] = await db.select({ value: count() }).from(feedSources);
  const [{ value: enabledSources }] = await db
    .select({ value: count() })
    .from(feedSources)
    .where(eq(feedSources.enabled, true));
  const [{ value: errorSources }] = await db
    .select({ value: count() })
    .from(feedSources)
    .where(eq(feedSources.lastFetchStatus, 'error'));

  return c.json({
    data: { totalItems, totalSources, enabledSources, errorSources },
  });
});

export { engineRoutes };

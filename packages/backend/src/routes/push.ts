import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { userPreferences, digests, pushLogs } from '../db/schema.js';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';
import { pushRegistry } from '../engine/push/index.js';
import { PushDispatcher } from '../engine/push/dispatcher.js';
import type { ChannelConfig, PushChannelType } from '../engine/push/types.js';

const pushRoutes = new Hono<{ Variables: AuthVariables }>();
pushRoutes.use('*', requireAuth);

const pushDispatcher = new PushDispatcher();

pushRoutes.get('/channels', async (c) => {
  const user = c.get('user');
  const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).get();

  const pushChannels = (prefs?.pushChannels as Record<string, unknown>) || {};
  const availableChannels = pushRegistry.listTypes();

  return c.json({
    data: {
      configured: pushChannels,
      available: availableChannels,
    },
  });
});

const telegramConfigSchema = z.object({
  enabled: z.boolean(),
  chatId: z.string().regex(/^-?\d+$/, 'Chat ID must be numeric').optional(),
  botToken: z.string().optional(),
  bindMethod: z.enum(['manual', 'bot_start']).optional(),
  boundAt: z.string().optional(),
});

pushRoutes.put('/channels/:type', async (c) => {
  const user = c.get('user');
  const type = c.req.param('type') as PushChannelType;

  if (type !== 'telegram') {
    return c.json({ error: 'Only telegram channel is available in MVP' }, 400);
  }

  const body = await c.req.json();
  const validatedConfig = telegramConfigSchema.parse(body);

  const channel = pushRegistry.get(type);
  if (channel && validatedConfig.enabled) {
    const config = { type, ...validatedConfig } as ChannelConfig;
    const validation = channel.validateConfig(config);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }
  }

  const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).get();
  if (!prefs) {
    return c.json({ error: 'Preferences not found' }, 404);
  }

  const pushChannels = (prefs.pushChannels as Record<string, unknown>) || {};
  pushChannels[type] = { ...validatedConfig, type };

  await db
    .update(userPreferences)
    .set({ pushChannels, updatedAt: new Date() })
    .where(eq(userPreferences.userId, user.id));

  return c.json({ ok: true, channel: { type, ...validatedConfig } });
});

pushRoutes.delete('/channels/:type', async (c) => {
  const user = c.get('user');
  const type = c.req.param('type');

  const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).get();
  if (!prefs) return c.json({ error: 'Preferences not found' }, 404);

  const pushChannels = (prefs.pushChannels as Record<string, unknown>) || {};
  delete pushChannels[type];

  await db
    .update(userPreferences)
    .set({ pushChannels, updatedAt: new Date() })
    .where(eq(userPreferences.userId, user.id));

  return c.json({ ok: true });
});

pushRoutes.post('/test', zValidator('json', z.object({
  channelType: z.enum(['telegram']),
})), async (c) => {
  const user = c.get('user');
  const { channelType } = c.req.valid('json');

  const channel = pushRegistry.get(channelType);
  if (!channel) {
    return c.json({ error: `Channel ${channelType} not available` }, 400);
  }

  const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).get();
  const pushChannels = (prefs?.pushChannels as Record<string, unknown>) || {};
  const channelPrefs = pushChannels[channelType] as Record<string, unknown> | undefined;

  if (!channelPrefs || !channelPrefs.enabled) {
    return c.json({ error: `Channel ${channelType} not configured or disabled` }, 400);
  }

  const config = { type: channelType, ...channelPrefs } as ChannelConfig;
  const result = await channel.sendTest(config);

  return c.json({
    success: result.success,
    error: result.error,
    durationMs: result.durationMs,
  });
});

pushRoutes.post('/send/:digestId', async (c) => {
  const user = c.get('user');
  const digestId = c.req.param('digestId');

  const digest = await db
    .select()
    .from(digests)
    .where(and(eq(digests.id, digestId), eq(digests.userId, user.id)))
    .get();

  if (!digest) return c.json({ error: 'Digest not found' }, 404);

  const result = await pushDispatcher.pushDigest(digestId);
  return c.json(result);
});

pushRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const limit = Number(c.req.query('limit') || '50');
  const channelType = c.req.query('channel');

  const results = await db
    .select()
    .from(pushLogs)
    .where(eq(pushLogs.userId, user.id))
    .orderBy(desc(pushLogs.createdAt))
    .limit(limit);

  const filtered = channelType ? results.filter((r) => r.channelType === channelType) : results;
  return c.json({ data: filtered });
});

pushRoutes.get('/stats', async (c) => {
  const user = c.get('user');

  const logs = await db.select().from(pushLogs).where(eq(pushLogs.userId, user.id));

  const stats = {
    total: logs.length,
    sent: logs.filter((l) => l.status === 'sent').length,
    failed: logs.filter((l) => l.status === 'failed' || l.status === 'exhausted').length,
    byChannel: {} as Record<string, { total: number; sent: number; failed: number }>,
  };

  for (const log of logs) {
    if (!stats.byChannel[log.channelType]) {
      stats.byChannel[log.channelType] = { total: 0, sent: 0, failed: 0 };
    }
    stats.byChannel[log.channelType].total++;
    if (log.status === 'sent') stats.byChannel[log.channelType].sent++;
    if (log.status === 'failed' || log.status === 'exhausted') stats.byChannel[log.channelType].failed++;
  }

  return c.json({ data: stats });
});

export { pushRoutes };

// packages/backend/src/routes/preferences.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/client.js';
import { userPreferences } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';

const preferencesRoutes = new Hono<{ Variables: AuthVariables }>();

preferencesRoutes.use('*', requireAuth);

const topicSchema = z.object({
  name: z.string().min(1).max(100),
  keywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string()).optional().default([]),
  boost: z.number().min(0.1).max(5.0).default(1.0),
});

const scheduleItemSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  count: z.number().int().min(1).max(20),
});

const scheduleSchema = z.object({
  flash: scheduleItemSchema.optional(),
  daily: scheduleItemSchema.optional(),
  deep: scheduleItemSchema.optional(),
  weekly: z.object({
    enabled: z.boolean(),
    dayOfWeek: z.number().int().min(0).max(6),
    time: z.string().regex(/^\d{2}:\d{2}$/),
  }).optional(),
  buzz: scheduleItemSchema.optional(),
});

const rankingSchema = z.object({
  tierWeights: z.record(z.string(), z.number()).optional(),
  buzzWeight: z.number().optional(),
  recencyHours: z.number().int().min(1).max(168).optional(),
  arcActiveBoost: z.number().optional(),
});

// ── GET preferences ──
preferencesRoutes.get('/', async (c) => {
  const user = c.get('user');
  let prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .get();

  if (!prefs) {
    const defaultPrefs = getDefaultPreferences(user.id);
    await db.insert(userPreferences).values(defaultPrefs);
    prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).get();
  }

  return c.json({ data: prefs });
});

// ── PUT preferences (full update) ──
const updatePrefsSchema = z.object({
  topics: z.array(topicSchema).optional(),
  schedule: scheduleSchema.optional(),
  ranking: rankingSchema.optional(),
  pushChannels: z.record(z.string(), z.unknown()).optional(),
  serendipity: z.object({
    enabled: z.boolean(),
    slotsPerDigest: z.number().int().min(0).max(5),
    strategy: z.string(),
    minBuzz: z.number().optional(),
  }).optional(),
  llmConfig: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    contextInjection: z.boolean().optional(),
    arcConfirm: z.boolean().optional(),
  }).optional(),
  alerts: z.object({
    enabled: z.boolean(),
    minBuzz: z.number().optional(),
    minTier1Sources: z.number().optional(),
    cooldownHours: z.number().optional(),
    quietHours: z.string().optional(),
  }).optional(),
});

preferencesRoutes.put('/', zValidator('json', updatePrefsSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const existing = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .get();

  if (!existing) {
    const defaultPrefs = getDefaultPreferences(user.id);
    await db.insert(userPreferences).values({ ...defaultPrefs, ...body, updatedAt: new Date() });
  } else {
    await db
      .update(userPreferences)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(userPreferences.userId, user.id));
  }

  const updated = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).get();
  return c.json({ data: updated });
});

// ── PUT topics only ──
preferencesRoutes.put('/topics', zValidator('json', z.object({ topics: z.array(topicSchema) })), async (c) => {
  const user = c.get('user');
  const { topics } = c.req.valid('json');

  await ensurePrefsExist(user.id);
  await db
    .update(userPreferences)
    .set({ topics, updatedAt: new Date() })
    .where(eq(userPreferences.userId, user.id));

  return c.json({ ok: true, topics });
});

// ── PUT schedule only ──
preferencesRoutes.put('/schedule', zValidator('json', z.object({ schedule: scheduleSchema })), async (c) => {
  const user = c.get('user');
  const { schedule } = c.req.valid('json');

  await ensurePrefsExist(user.id);
  await db
    .update(userPreferences)
    .set({ schedule, updatedAt: new Date() })
    .where(eq(userPreferences.userId, user.id));

  return c.json({ ok: true, schedule });
});

// ── Topic templates ──
preferencesRoutes.get('/topic-templates', async (c) => {
  return c.json({ data: TOPIC_TEMPLATES });
});

// ── Helpers ──

async function ensurePrefsExist(userId: string): Promise<void> {
  const existing = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .get();

  if (!existing) {
    await db.insert(userPreferences).values(getDefaultPreferences(userId));
  }
}

function getDefaultPreferences(userId: string) {
  return {
    id: nanoid(),
    userId,
    topics: [] as { name: string; keywords: string[]; excludeKeywords?: string[]; boost: number }[],
    ranking: {
      tierWeights: { '1': 2.0, '2': 1.5, '3': 1.0, '4': 0.7 },
      buzzWeight: 1.2,
      recencyHours: 24,
      arcActiveBoost: 1.3,
    },
    schedule: {
      flash: { enabled: true, time: '07:30', count: 8 },
      daily: { enabled: true, time: '09:00', count: 8 },
      deep: { enabled: true, time: '20:00', count: 2 },
    },
    pushChannels: { web: { enabled: true } },
    serendipity: { enabled: true, slotsPerDigest: 1, strategy: 'high_buzz_outside_topics' },
    llmConfig: { provider: process.env.LLM_PROVIDER || 'none', contextInjection: true },
    alerts: { enabled: false },
    updatedAt: new Date(),
  };
}

const TOPIC_TEMPLATES = [
  { name: 'AI/ML', keywords: ['OpenAI', 'Anthropic', 'Claude', 'GPT', 'Gemini', 'LLM', 'AI', 'machine learning', 'deep learning'], excludeKeywords: [] as string[], boost: 1.5 },
  { name: '前端开发', keywords: ['React', 'Vue', 'Next.js', 'TypeScript', 'JavaScript', 'CSS', 'Vite', 'Tailwind', 'Svelte'], excludeKeywords: [] as string[], boost: 1.0 },
  { name: '加密货币', keywords: ['Bitcoin', 'Ethereum', 'crypto', 'blockchain', 'DeFi', 'NFT', 'Web3'], excludeKeywords: [] as string[], boost: 1.0 },
  { name: '地缘政治', keywords: ['geopolitics', 'sanctions', 'trade war', 'NATO', 'UN', 'diplomacy', '外交', '制裁'], excludeKeywords: [] as string[], boost: 1.0 },
  { name: '创业投资', keywords: ['startup', 'funding', 'VC', 'Series A', 'IPO', 'Y Combinator', 'valuation', '融资', '估值'], excludeKeywords: [] as string[], boost: 1.0 },
  { name: 'Apple', keywords: ['Apple', 'iPhone', 'macOS', 'WWDC', 'Vision Pro', 'iPad', 'Swift', 'iOS'], excludeKeywords: ['apple juice', 'apple pie', 'apple cider'], boost: 1.0 },
];

export { preferencesRoutes };

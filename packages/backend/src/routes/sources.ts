import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/client.js';
import { feedSources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth, requireAdmin, type AuthVariables } from '../middleware/auth.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

interface SourcePackEntry {
  name: string;
  url?: string;
  type: string;
  tier: number;
  category?: string;
  tags?: string[];
  language?: string;
  fetchConfig?: Record<string, unknown>;
}

const sourceRoutes = new Hono<{ Variables: AuthVariables }>();

// All routes require auth + admin
sourceRoutes.use('*', requireAuth, requireAdmin);

// ── List all sources ──
sourceRoutes.get('/', async (c) => {
  const sources = await db.select().from(feedSources);
  return c.json({ data: sources });
});

// ── Get single source ──
sourceRoutes.get('/:id', async (c) => {
  const source = await db.select().from(feedSources).where(eq(feedSources.id, c.req.param('id'))).get();
  if (!source) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: source });
});

// ── Create source ──
const createSourceSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().max(2000).default(''),
  type: z.enum(['rss', 'atom', 'google-news', 'x', 'v2ex', 'youtube', 'wechat', 'custom']),
  tier: z.number().int().min(1).max(4).default(3),
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  language: z.string().optional(),
  enabled: z.boolean().default(true),
  fetchConfig: z.record(z.unknown()).optional(),
  isGlobal: z.boolean().default(false),
});

sourceRoutes.post('/', zValidator('json', createSourceSchema), async (c) => {
  const body = c.req.valid('json');
  const user = c.get('user');
  const id = nanoid();
  const now = new Date();

  await db.insert(feedSources).values({
    id,
    ...body,
    fetchConfig: body.fetchConfig || null,
    createdBy: user.id,
    createdAt: now,
  });

  const created = await db.select().from(feedSources).where(eq(feedSources.id, id)).get();
  return c.json({ data: created }, 201);
});

// ── Update source ──
const updateSourceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().max(2000).optional(),
  tier: z.number().int().min(1).max(4).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  language: z.string().optional(),
  enabled: z.boolean().optional(),
  fetchConfig: z.record(z.unknown()).optional(),
  isGlobal: z.boolean().optional(),
});

sourceRoutes.patch('/:id', zValidator('json', updateSourceSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await db.select().from(feedSources).where(eq(feedSources.id, id)).get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.update(feedSources).set(body).where(eq(feedSources.id, id));

  const updated = await db.select().from(feedSources).where(eq(feedSources.id, id)).get();
  return c.json({ data: updated });
});

// ── Delete source ──
sourceRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await db.select().from(feedSources).where(eq(feedSources.id, id)).get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.delete(feedSources).where(eq(feedSources.id, id));
  return c.json({ message: 'Deleted' });
});

// ── Import from source-packs directory ──
sourceRoutes.post('/import/packs', async (c) => {
  const sourcePackDir = join(process.cwd(), '../../source-packs');
  let files: string[];

  try {
    files = readdirSync(sourcePackDir).filter(f => f.endsWith('.yaml'));
  } catch {
    return c.json({ error: 'source-packs directory not found' }, 404);
  }

  const results: { file: string; imported: number; skipped: number }[] = [];

  for (const file of files) {
    const content = readFileSync(join(sourcePackDir, file), 'utf-8');
    const pack = parseYaml(content) as { sources?: SourcePackEntry[] };

    if (!pack.sources) {
      results.push({ file, imported: 0, skipped: 0 });
      continue;
    }

    let imported = 0;
    let skipped = 0;

    for (const source of pack.sources) {
      const existing = await db.select()
        .from(feedSources)
        .where(eq(feedSources.name, source.name))
        .get();

      if (existing) {
        skipped++;
        continue;
      }

      await db.insert(feedSources).values({
        id: nanoid(),
        name: source.name,
        url: source.url || '',
        type: source.type as any,
        tier: source.tier,
        category: source.category || null,
        tags: source.tags || [],
        language: source.language || null,
        enabled: true,
        fetchConfig: source.fetchConfig || null,
        isGlobal: true,
        createdAt: new Date(),
      });

      imported++;
    }

    results.push({ file, imported, skipped });
  }

  return c.json({ data: results });
});

// ── Import from uploaded YAML body ──
const importYamlSchema = z.object({
  yaml: z.string().min(1),
});

sourceRoutes.post('/import/yaml', zValidator('json', importYamlSchema), async (c) => {
  const { yaml: yamlContent } = c.req.valid('json');
  const pack = parseYaml(yamlContent) as { sources?: SourcePackEntry[] };

  if (!pack.sources || pack.sources.length === 0) {
    return c.json({ error: 'No sources found in YAML' }, 400);
  }

  let imported = 0;

  for (const source of pack.sources) {
    await db.insert(feedSources).values({
      id: nanoid(),
      name: source.name,
      url: source.url || '',
      type: source.type as any,
      tier: source.tier,
      category: source.category || null,
      tags: source.tags || [],
      language: source.language || null,
      enabled: true,
      fetchConfig: source.fetchConfig || null,
      isGlobal: true,
      createdAt: new Date(),
    });
    imported++;
  }

  return c.json({ data: { imported } });
});

export { sourceRoutes };

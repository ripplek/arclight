import { db } from './client.js';
import { feedSources } from './schema.js';
import { nanoid } from 'nanoid';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { logger } from '../shared/logger.js';

// ── Source Pack Types ──

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

interface SourcePack {
  sources: SourcePackEntry[];
}

// ── Import source-packs ──

function seedSources() {
  const sourcePackDir = join(process.cwd(), '../../source-packs');
  let files: string[];

  try {
    files = readdirSync(sourcePackDir).filter(f => f.endsWith('.yaml'));
  } catch {
    logger.warn('source-packs directory not found, skipping');
    return;
  }

  let imported = 0;

  for (const file of files) {
    const content = readFileSync(join(sourcePackDir, file), 'utf-8');
    const pack: SourcePack = parseYaml(content);

    if (!pack.sources) {
      logger.warn({ file }, 'No sources found in pack');
      continue;
    }

    for (const source of pack.sources) {
      const id = nanoid();
      const now = new Date();

      db.insert(feedSources).values({
        id,
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
        createdAt: now,
      }).onConflictDoNothing().run();

      imported++;
    }

    logger.info({ file, count: pack.sources.length }, 'Imported source pack');
  }

  logger.info({ total: imported }, 'Total sources imported');
}

// ── Main ──

function main() {
  logger.info('🌱 Starting seed...');

  seedSources();

  logger.info('🌱 Seed complete!');
  process.exit(0);
}

main();

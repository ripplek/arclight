// packages/backend/src/engine/scheduler.ts
import cron from 'node-cron';
import { db } from '../db/client.js';
import { feedSources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { FetchManager, type FetchSource } from './fetch-manager.js';
import { normalize } from './normalizer.js';
import { dedup } from './dedup.js';
import { storeItems, updateSourceStatus } from './store.js';
import { logger } from '../shared/logger.js';

const CIRCUIT_BREAKER_THRESHOLD = 10;

/** Default fetch intervals (minutes) by tier */
const DEFAULT_INTERVALS: Record<number, number> = {
  1: 15,
  2: 30,
  3: 60,
  4: 30,
};

export class FeedScheduler {
  private fetchManager: FetchManager;
  private tasks: cron.ScheduledTask[] = [];
  private running = false;

  constructor() {
    this.fetchManager = new FetchManager();
  }

  /** Start the scheduler: check every minute if sources are due */
  start(): void {
    if (this.running) return;
    this.running = true;

    const task = cron.schedule('* * * * *', async () => {
      try {
        await this.tick();
      } catch (err) {
        logger.error({ error: err }, 'Scheduler tick error');
      }
    });
    this.tasks.push(task);

    logger.info('Feed scheduler started');
    this.tick().catch((err) => logger.error({ error: err }, 'Initial tick error'));
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    this.running = false;
    logger.info('Feed scheduler stopped');
  }

  /** Execute one fetch cycle */
  async tick(): Promise<{ fetched: number; inserted: number }> {
    const sources = await db
      .select()
      .from(feedSources)
      .where(eq(feedSources.enabled, true));

    const now = Date.now();
    const dueSources: FetchSource[] = [];

    for (const src of sources) {
      if ((src.fetchErrorCount ?? 0) >= CIRCUIT_BREAKER_THRESHOLD) continue;

      const interval = (src.fetchConfig as Record<string, unknown> | null)?.intervalMinutes as number | undefined
        ?? DEFAULT_INTERVALS[src.tier] ?? 60;
      const intervalMs = interval * 60 * 1000;

      const lastFetched = src.lastFetchedAt ? new Date(src.lastFetchedAt).getTime() : 0;
      if (now - lastFetched >= intervalMs) {
        dueSources.push({
          id: src.id,
          url: src.url,
          name: src.name,
          type: src.type,
          tier: src.tier,
          fetchConfig: src.fetchConfig as Record<string, unknown> | undefined,
        });
      }
    }

    if (dueSources.length === 0) {
      return { fetched: 0, inserted: 0 };
    }

    logger.info({ count: dueSources.length }, 'Sources due for fetching');

    const results = await this.fetchManager.fetchBatch(dueSources);
    let totalInserted = 0;
    const fetchedAt = new Date();

    for (const result of results) {
      await updateSourceStatus(result);

      if (result.status === 'error') {
        const src = sources.find((s) => s.id === result.source.id);
        const newErrorCount = (src?.fetchErrorCount ?? 0) + 1;
        if (newErrorCount >= CIRCUIT_BREAKER_THRESHOLD) {
          await db
            .update(feedSources)
            .set({ enabled: false })
            .where(eq(feedSources.id, result.source.id));
          logger.warn({ source: result.source.name, errors: newErrorCount }, 'Source auto-disabled (circuit breaker)');
        }
        continue;
      }

      if (result.items.length === 0) continue;

      const normalized = normalize(result.items, result.source, fetchedAt);
      const deduped = dedup(normalized);
      const { inserted } = await storeItems(deduped);
      totalInserted += inserted;
    }

    logger.info({ sources: dueSources.length, inserted: totalInserted }, 'Fetch cycle complete');
    return { fetched: dueSources.length, inserted: totalInserted };
  }

  /** Manual full fetch (admin API) */
  async fetchAll(): Promise<{ fetched: number; inserted: number }> {
    const sources = await db
      .select()
      .from(feedSources)
      .where(eq(feedSources.enabled, true));

    const fetchSources: FetchSource[] = sources.map((src) => ({
      id: src.id,
      url: src.url,
      name: src.name,
      type: src.type,
      tier: src.tier,
      fetchConfig: src.fetchConfig as Record<string, unknown> | undefined,
    }));

    const results = await this.fetchManager.fetchBatch(fetchSources);
    const fetchedAt = new Date();
    let totalInserted = 0;

    for (const result of results) {
      await updateSourceStatus(result);
      if (result.status !== 'ok' || result.items.length === 0) continue;

      const normalized = normalize(result.items, result.source, fetchedAt);
      const deduped = dedup(normalized);
      const { inserted } = await storeItems(deduped);
      totalInserted += inserted;
    }

    return { fetched: fetchSources.length, inserted: totalInserted };
  }
}

// Singleton
let schedulerInstance: FeedScheduler | null = null;

export function getScheduler(): FeedScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new FeedScheduler();
  }
  return schedulerInstance;
}

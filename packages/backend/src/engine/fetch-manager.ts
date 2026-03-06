// packages/backend/src/engine/fetch-manager.ts
import pLimit from 'p-limit';
import { createAdapterRegistry } from './adapters/index.js';
import type { FeedAdapter, RawFeedItem, FetchOptions } from '@arclight/shared';
import { logger } from '../shared/logger.js';

export interface FetchSource {
  id: string;
  url: string;
  name: string;
  type: string;
  tier: number;
  fetchConfig?: Record<string, unknown>;
}

export interface FetchResult {
  source: FetchSource;
  items: RawFeedItem[];
  status: 'ok' | 'error';
  error?: string;
  durationMs: number;
}

export interface FetchManagerOptions {
  concurrency?: number;
  maxRetries?: number;
  defaultTimeout?: number;
  defaultMaxItems?: number;
}

export class FetchManager {
  private adapters: FeedAdapter[];
  private limit: ReturnType<typeof pLimit>;
  private maxRetries: number;
  private defaultTimeout: number;
  private defaultMaxItems: number;

  constructor(options: FetchManagerOptions = {}) {
    this.adapters = createAdapterRegistry();
    this.limit = pLimit(options.concurrency ?? 5);
    this.maxRetries = options.maxRetries ?? 3;
    this.defaultTimeout = options.defaultTimeout ?? 30_000;
    this.defaultMaxItems = options.defaultMaxItems ?? 50;
  }

  /** 批量抓取多个源 */
  async fetchBatch(sources: FetchSource[]): Promise<FetchResult[]> {
    const results = await Promise.allSettled(
      sources.map((source) => this.limit(() => this.fetchWithRetry(source))),
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        source: sources[i],
        items: [],
        status: 'error' as const,
        error: result.reason?.message || 'Unknown error',
        durationMs: 0,
      };
    });
  }

  /** 单源抓取 + 指数退避重试 */
  private async fetchWithRetry(source: FetchSource): Promise<FetchResult> {
    const adapter = this.findAdapter(source);
    if (!adapter) {
      return {
        source,
        items: [],
        status: 'error',
        error: `No adapter for type: ${source.type}`,
        durationMs: 0,
      };
    }

    const fetchOptions: FetchOptions = {
      maxItems: (source.fetchConfig?.maxItems as number) ?? this.defaultMaxItems,
      timeout: (source.fetchConfig?.timeout as number) ?? this.defaultTimeout,
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const start = Date.now();
      try {
        const items = await adapter.fetch(source, fetchOptions);
        const durationMs = Date.now() - start;
        logger.info({ source: source.name, items: items.length, durationMs }, 'Fetch success');
        return { source, items, status: 'ok', durationMs };
      } catch (err: unknown) {
        const durationMs = Date.now() - start;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt === this.maxRetries) {
          logger.error({ source: source.name, attempt, error: errMsg, durationMs }, 'Fetch failed (final)');
          return { source, items: [], status: 'error', error: errMsg, durationMs };
        }
        const delay = 1000 * Math.pow(2, attempt - 1);
        logger.warn({ source: source.name, attempt, delay, error: errMsg }, 'Fetch retry');
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return { source, items: [], status: 'error', error: 'Exhausted retries', durationMs: 0 };
  }

  private findAdapter(source: FetchSource): FeedAdapter | undefined {
    return this.adapters.find((a) => a.supports({ type: source.type, url: source.url }));
  }
}

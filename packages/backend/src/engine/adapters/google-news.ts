import type { FeedAdapter, RawFeedItem, FetchOptions } from '@arclight/shared';
import { RssAdapter } from './rss.js';

/**
 * Google News meta-source adapter.
 *
 * Constructs Google News RSS search URLs on-the-fly, enabling aggregated
 * results from sites that don't have their own RSS feeds.
 *
 * Inspired by WorldMonitor's gn() helper:
 *   const gn = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
 */
export class GoogleNewsAdapter implements FeedAdapter {
  type = 'google-news';
  private rssAdapter = new RssAdapter();

  supports(source: { type: string }): boolean {
    return source.type === 'google-news';
  }

  /**
   * Build a Google News RSS search URL.
   *
   * @param query - Search query (supports Google search operators like `site:`, `when:`, `OR`)
   * @param options - Language/region options
   *
   * @example
   *   gn('site:reuters.com world')
   *   gn('(OpenAI OR Anthropic) when:2d')
   *   gn('site:reuters.com', { hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' })
   */
  static gn(
    query: string,
    options?: { hl?: string; gl?: string; ceid?: string },
  ): string {
    const hl = options?.hl ?? 'en-US';
    const gl = options?.gl ?? 'US';
    const ceid = options?.ceid ?? 'US:en';
    return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  }

  async fetch(
    source: { url: string; name: string; type: string; fetchConfig?: { query?: string } },
    options: FetchOptions,
  ): Promise<RawFeedItem[]> {
    // If the source has a query in fetchConfig, build the URL dynamically
    const url = source.fetchConfig?.query
      ? GoogleNewsAdapter.gn(source.fetchConfig.query)
      : source.url;

    // Delegate to RSS adapter since Google News outputs standard RSS
    return this.rssAdapter.fetch(
      { url, name: source.name, type: 'rss' },
      options,
    );
  }
}

// Convenience export
export const gn = GoogleNewsAdapter.gn;

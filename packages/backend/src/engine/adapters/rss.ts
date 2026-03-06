import type { FeedAdapter, RawFeedItem, FetchOptions } from '@arclight/shared';

/**
 * RSS/Atom feed adapter.
 * Fetches and parses standard RSS 2.0 and Atom feeds.
 */
export class RssAdapter implements FeedAdapter {
  type = 'rss';

  supports(source: { type: string }): boolean {
    return source.type === 'rss' || source.type === 'atom';
  }

  async fetch(
    source: { url: string; name: string; type: string; fetchConfig?: Record<string, unknown> },
    options: FetchOptions,
  ): Promise<RawFeedItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout);

    try {
      const resp = await fetch(source.url, {
        headers: {
          'User-Agent': 'ArcLight/1.0',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} from ${source.name}`);
      }

      const xml = await resp.text();
      return this.parseRss(xml, source.name, options);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseRss(xml: string, sourceName: string, options: FetchOptions): RawFeedItem[] {
    // TODO: Implement XML parsing (use fast-xml-parser or migrate v1 logic)
    // For now, return empty — will be implemented in milestone 3
    return [];
  }
}

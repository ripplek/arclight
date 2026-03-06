// packages/backend/src/engine/adapters/rss.ts
import { XMLParser } from 'fast-xml-parser';
import type { FeedAdapter, RawFeedItem, FetchOptions } from '@arclight/shared';
import { logger } from '../../shared/logger.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (_name: string) => {
    return ['item', 'entry', 'link', 'category'].includes(_name);
  },
  parseTagValue: true,
  trimValues: true,
});

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
          'User-Agent': 'ArcLight/1.0 (+https://github.com/nicepkg/arclight)',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} from ${source.name}`);
      }

      const xml = await resp.text();
      const items = this.parse(xml, source.name);
      return items.slice(0, options.maxItems);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 解析 XML 字符串，自动识别 RSS 2.0 / Atom 格式
   */
  parse(xml: string, sourceName: string): RawFeedItem[] {
    try {
      const parsed = xmlParser.parse(xml);

      // RSS 2.0: rss > channel > item[]
      if (parsed.rss?.channel) {
        return this.parseRss2(parsed.rss.channel, sourceName);
      }

      // Atom: feed > entry[]
      if (parsed.feed?.entry) {
        return this.parseAtom(parsed.feed, sourceName);
      }

      // RDF/RSS 1.0: rdf:RDF > item[]
      if (parsed['rdf:RDF']?.item) {
        return this.parseRss2({ item: parsed['rdf:RDF'].item }, sourceName);
      }

      logger.warn({ sourceName }, 'Unknown feed format, no items found');
      return [];
    } catch (err) {
      logger.error({ sourceName, error: err }, 'XML parse error');
      return [];
    }
  }

  // ── RSS 2.0 ──

  private parseRss2(channel: Record<string, unknown>, sourceName: string): RawFeedItem[] {
    const items: Record<string, unknown>[] = (channel.item as Record<string, unknown>[]) || [];
    return items
      .map((item) => this.mapRss2Item(item, sourceName))
      .filter(Boolean) as RawFeedItem[];
  }

  private mapRss2Item(item: Record<string, unknown>, _sourceName: string): RawFeedItem | null {
    const link = item.link;
    const guidObj = item.guid as Record<string, unknown> | string | undefined;
    const guidText = typeof guidObj === 'object' && guidObj !== null ? (guidObj['#text'] as string) : (guidObj as string);
    const url = (typeof link === 'string' ? link : guidText) ?? '';
    if (!url || typeof url !== 'string') return null;

    const title = this.cleanHtml(item.title);
    const content = this.cleanHtml(
      (item.description as string) || (item['content:encoded'] as string) || '',
    );
    const author = (item['dc:creator'] as string) || (item.author as string);
    const pubDate = (item.pubDate as string) || (item['dc:date'] as string);

    return {
      externalId: (guidText || url) as string,
      url: url.trim(),
      title: title || undefined,
      content: content || undefined,
      author: author ? { name: String(author) } : undefined,
      publishedAt: pubDate ? this.parseDate(pubDate) : undefined,
    };
  }

  // ── Atom ──

  private parseAtom(feed: Record<string, unknown>, sourceName: string): RawFeedItem[] {
    const entries: Record<string, unknown>[] = (feed.entry as Record<string, unknown>[]) || [];
    return entries
      .map((entry) => this.mapAtomEntry(entry, sourceName))
      .filter(Boolean) as RawFeedItem[];
  }

  private mapAtomEntry(entry: Record<string, unknown>, _sourceName: string): RawFeedItem | null {
    const rawLink = entry.link;
    const links: Record<string, unknown>[] = Array.isArray(rawLink) ? rawLink : [rawLink].filter(Boolean) as Record<string, unknown>[];
    const altLink = links.find((l) => (l as Record<string, unknown>)?.['@_rel'] === 'alternate') || links[0];
    const url = (altLink as Record<string, unknown>)?.['@_href'] || altLink;
    if (!url || typeof url !== 'string') return null;

    const rawTitle = entry.title;
    const title = this.cleanHtml(
      typeof rawTitle === 'object' && rawTitle !== null ? (rawTitle as Record<string, unknown>)['#text'] : rawTitle,
    );

    const rawContent = entry.content as Record<string, unknown> | string | undefined;
    const rawSummary = entry.summary as Record<string, unknown> | string | undefined;
    const contentText = (typeof rawContent === 'object' && rawContent !== null ? rawContent['#text'] : rawContent) ||
      (typeof rawSummary === 'object' && rawSummary !== null ? rawSummary['#text'] : rawSummary) || '';
    const content = this.cleanHtml(contentText);

    const authorObj = entry.author as Record<string, unknown> | string | undefined;
    const author = typeof authorObj === 'object' && authorObj !== null ? (authorObj.name as string) : (authorObj as string);

    return {
      externalId: ((entry.id as string) || url) as string,
      url: url.trim(),
      title: title || undefined,
      content: typeof content === 'string' ? content : undefined,
      author: author ? { name: String(author) } : undefined,
      publishedAt: (entry.published || entry.updated)
        ? this.parseDate(String(entry.published || entry.updated))
        : undefined,
    };
  }

  // ── Helpers ──

  private parseDate(dateStr: string | number): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(String(dateStr));
    return isNaN(d.getTime()) ? undefined : d;
  }

  private cleanHtml(text: unknown): string {
    if (!text) return '';
    return String(text)
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
  }
}

import type { FeedAdapter } from '@arclight/shared';
import { RssAdapter } from './rss.js';
import { GoogleNewsAdapter } from './google-news.js';

/** Registry of all available feed adapters */
export function createAdapterRegistry(): FeedAdapter[] {
  return [
    new RssAdapter(),
    new GoogleNewsAdapter(),
    // TODO Phase 2: XAdapter, V2exAdapter, YouTubeAdapter
  ];
}

export { RssAdapter } from './rss.js';
export { GoogleNewsAdapter, gn } from './google-news.js';

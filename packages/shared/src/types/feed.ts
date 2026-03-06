// ═══════════════════════════════════════════
// Feed Types
// ═══════════════════════════════════════════

import type { SourceTier } from './source.js';

export interface RawFeedItem {
  externalId: string;
  url: string;
  title?: string;
  content?: string;
  author?: { name?: string; handle?: string };
  publishedAt?: Date;
  metrics?: Record<string, number>;
  raw?: unknown;
}

export interface FeedItem {
  id: string;
  sourceId: string;
  externalId?: string;
  url: string;
  title?: string;
  content?: string;
  author?: { name?: string; handle?: string; avatarUrl?: string };
  language?: string;
  tier?: SourceTier;
  publishedAt?: Date;
  fetchedAt: Date;

  // Metrics
  metrics?: {
    likes?: number;
    reposts?: number;
    replies?: number;
    views?: number;
  };

  // Buzz signal
  buzz?: {
    crossSourceCount?: number;
    socialEngagement?: number;
    velocity?: number;
    score?: number;
  };

  // Entity extraction
  entities?: string[];
  tags?: string[];

  // Dedup
  dedupHash?: string;
  dedupClusterId?: string;

  // LLM-generated
  contextInjection?: string;
  whyImportant?: string;

  // Story Arc
  arc?: {
    id: string;
    title: string;
    position: number;
    daysSinceStart: number;
  };

  // Ranking
  score?: number;
}

export interface FetchOptions {
  maxItems: number;
  timeout: number;
  since?: Date;
}

export interface FeedAdapter {
  type: string;
  supports(source: { type: string; url?: string }): boolean;
  fetch(
    source: {
      url: string;
      name: string;
      type: string;
      fetchConfig?: Record<string, unknown>;
    },
    options: FetchOptions,
  ): Promise<RawFeedItem[]>;
}

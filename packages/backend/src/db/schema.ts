import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// ═══════════════════════════════════════════
// Users & Auth (better-auth compatible)
// ═══════════════════════════════════════════

export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  // --- ArcLight custom fields ---
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  timezone: text('timezone').default('UTC'),
  locale: text('locale').default('zh-CN'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

export const accounts = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => users.id),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('idToken'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

export const verifications = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }),
});

// ═══════════════════════════════════════════
// Feed Sources
// ═══════════════════════════════════════════

export const feedSources = sqliteTable('feed_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  type: text('type', {
    enum: ['rss', 'atom', 'google-news', 'x', 'v2ex', 'youtube', 'wechat', 'custom'],
  }).notNull(),
  tier: integer('tier').notNull().default(3),
  category: text('category'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  language: text('language'),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  fetchConfig: text('fetch_config', { mode: 'json' }).$type<Record<string, unknown>>(),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  lastFetchStatus: text('last_fetch_status'),
  fetchErrorCount: integer('fetch_error_count').default(0),
  isGlobal: integer('is_global', { mode: 'boolean' }).default(false),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const userSources = sqliteTable('user_sources', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  sourceId: text('source_id').notNull().references(() => feedSources.id),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  customWeight: real('custom_weight'),
  customTags: text('custom_tags', { mode: 'json' }).$type<string[]>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ═══════════════════════════════════════════
// Feed Items
// ═══════════════════════════════════════════

export const feedItems = sqliteTable('feed_items', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => feedSources.id),
  externalId: text('external_id'),
  url: text('url').notNull(),
  title: text('title'),
  content: text('content'),
  author: text('author', { mode: 'json' }).$type<{
    name?: string;
    handle?: string;
    avatarUrl?: string;
  }>(),
  language: text('language'),
  tier: integer('tier'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
  metrics: text('metrics', { mode: 'json' }).$type<{
    likes?: number;
    reposts?: number;
    replies?: number;
    views?: number;
  }>(),
  buzzData: text('buzz_data', { mode: 'json' }).$type<{
    crossSourceCount?: number;
    socialEngagement?: number;
    velocity?: number;
    score?: number;
  }>(),
  entities: text('entities', { mode: 'json' }).$type<string[]>().default([]),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  dedupHash: text('dedup_hash'),
  dedupClusterId: text('dedup_cluster_id'),
  contextInjection: text('context_injection'),
  whyImportant: text('why_important'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ═══════════════════════════════════════════
// Story Arcs
// ═══════════════════════════════════════════

export const storyArcs = sqliteTable('story_arcs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  summary: text('summary'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  entities: text('entities', { mode: 'json' }).$type<string[]>().default([]),
  status: text('status', { enum: ['active', 'dormant', 'closed'] }).notNull().default('active'),
  firstSeen: integer('first_seen', { mode: 'timestamp' }).notNull(),
  lastUpdated: integer('last_updated', { mode: 'timestamp' }).notNull(),
  itemCount: integer('item_count').default(0),
  timeline: text('timeline', { mode: 'json' }).$type<{
    date: string;
    headline: string;
    itemId: string;
  }[]>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const arcItems = sqliteTable('arc_items', {
  id: text('id').primaryKey(),
  arcId: text('arc_id').notNull().references(() => storyArcs.id),
  itemId: text('item_id').notNull().references(() => feedItems.id),
  position: integer('position').notNull(),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
});

// ═══════════════════════════════════════════
// User Preferences
// ═══════════════════════════════════════════

export const userPreferences = sqliteTable('user_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id).unique(),
  topics: text('topics', { mode: 'json' }).$type<{
    name: string;
    keywords: string[];
    excludeKeywords?: string[];
    boost: number;
  }[]>().default([]),
  ranking: text('ranking', { mode: 'json' }).$type<{
    tierWeights?: Record<number, number>;
    buzzWeight?: number;
    recencyHours?: number;
    arcActiveBoost?: number;
  }>(),
  schedule: text('schedule', { mode: 'json' }).$type<{
    flash?: { enabled: boolean; time: string; count: number };
    daily?: { enabled: boolean; time: string; count: number };
    deep?: { enabled: boolean; time: string; count: number };
    weekly?: { enabled: boolean; dayOfWeek: number; time: string };
    buzz?: { enabled: boolean; time: string; count: number };
  }>(),
  pushChannels: text('push_channels', { mode: 'json' }).$type<{
    web?: { enabled: boolean };
    telegram?: {
      enabled: boolean;
      chatId?: string;
      botToken?: string;
      bindMethod?: 'manual' | 'bot_start';
      boundAt?: string;
    };
    email?: { enabled: boolean; address?: string; verified?: boolean };
    webhook?: { enabled: boolean; url?: string; headers?: Record<string, string>; secret?: string };
  }>(),
  serendipity: text('serendipity', { mode: 'json' }).$type<{
    enabled: boolean;
    slotsPerDigest: number;
    strategy: string;
    minBuzz?: number;
  }>(),
  llmConfig: text('llm_config', { mode: 'json' }).$type<{
    provider?: string;
    model?: string;
    apiKey?: string;
    contextInjection?: boolean;
    arcConfirm?: boolean;
  }>(),
  alerts: text('alerts', { mode: 'json' }).$type<{
    enabled: boolean;
    minBuzz?: number;
    minTier1Sources?: number;
    cooldownHours?: number;
    quietHours?: string;
  }>(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ═══════════════════════════════════════════
// Digests
// ═══════════════════════════════════════════

export const digests = sqliteTable('digests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  tier: text('tier', {
    enum: ['flash', 'daily', 'deep', 'weekly', 'buzz', 'alert'],
  }).notNull(),
  date: text('date').notNull(),
  contentMarkdown: text('content_markdown'),
  contentHtml: text('content_html'),
  itemIds: text('item_ids', { mode: 'json' }).$type<string[]>().default([]),
  arcIds: text('arc_ids', { mode: 'json' }).$type<string[]>(),
  metadata: text('metadata', { mode: 'json' }).$type<{
    itemCount: number;
    generatedAt: string;
    llmCost?: number;
    pipelineDurationMs?: number;
  }>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  pushedAt: integer('pushed_at', { mode: 'timestamp' }),
  pushStatus: text('push_status', {
    enum: ['pending', 'sending', 'sent', 'partial', 'failed', 'exhausted', 'skipped'],
  }).default('pending'),
  pushAttempts: integer('push_attempts').default(0),
});

// ═══════════════════════════════════════════
// Push Logs
// ═══════════════════════════════════════════

export const pushLogs = sqliteTable('push_logs', {
  id: text('id').primaryKey(),
  digestId: text('digest_id').notNull().references(() => digests.id),
  userId: text('user_id').notNull().references(() => users.id),
  channelType: text('channel_type', { enum: ['telegram', 'email', 'webhook'] }).notNull(),
  status: text('status', { enum: ['pending', 'sending', 'sent', 'failed', 'exhausted'] }).notNull(),
  externalId: text('external_id'),
  error: text('error'),
  retryable: integer('retryable').default(0),
  attempt: integer('attempt').default(1),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userIdIdx: index('idx_push_logs_user_id').on(table.userId),
  digestIdIdx: index('idx_push_logs_digest_id').on(table.digestId),
  retryIdx: index('idx_push_logs_retry').on(table.status, table.retryable),
}));

// ═══════════════════════════════════════════
// Consumption Memory
// ═══════════════════════════════════════════

export const consumption = sqliteTable('consumption', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  itemId: text('item_id').notNull().references(() => feedItems.id),
  digestId: text('digest_id').references(() => digests.id),
  action: text('action', {
    enum: ['delivered', 'viewed', 'clicked', 'skipped', 'bookmarked', 'feedback_up', 'feedback_down'],
  }).notNull(),
  tier: text('tier'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

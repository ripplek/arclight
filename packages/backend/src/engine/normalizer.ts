// packages/backend/src/engine/normalizer.ts
import { nanoid } from 'nanoid';
import type { RawFeedItem } from '@arclight/shared';
import type { FetchSource } from './fetch-manager.js';

export interface NormalizedItem {
  id: string;
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  content: string;
  author: { name?: string; handle?: string; avatarUrl?: string } | null;
  language: string | null;
  tier: number;
  publishedAt: Date | null;
  fetchedAt: Date;
  entities: string[];
  tags: string[];
  dedupHash: string;
}

/** Known entities for rule-based extraction */
const KNOWN_ENTITIES: string[] = [
  'OpenAI', 'Anthropic', 'Google', 'Apple', 'Microsoft', 'Meta', 'Amazon', 'Tesla',
  'NVIDIA', 'SpaceX', 'DeepMind', 'Mistral', 'xAI', 'ByteDance', 'Tencent', 'Alibaba',
  'Samsung', 'Intel', 'AMD', 'Qualcomm', 'ARM', 'TSMC',
  'EU', 'FDA', 'SEC', 'FTC', 'WHO', 'NATO', 'UN',
  'China', 'US', 'Japan', 'India', 'Russia', 'Ukraine',
  'GPT', 'Claude', 'Gemini', 'Llama', 'ChatGPT', 'Copilot',
  'iPhone', 'Android', 'Bitcoin', 'Ethereum',
];

/**
 * 将 RawFeedItem[] 转换为 NormalizedItem[]
 */
export function normalize(
  rawItems: RawFeedItem[],
  source: FetchSource,
  fetchedAt: Date = new Date(),
): NormalizedItem[] {
  return rawItems
    .map((raw) => normalizeOne(raw, source, fetchedAt))
    .filter(Boolean) as NormalizedItem[];
}

function normalizeOne(
  raw: RawFeedItem,
  source: FetchSource,
  fetchedAt: Date,
): NormalizedItem | null {
  const rawUrl = raw.url?.trim();
  if (!rawUrl) return null;

  const url = decodeGoogleNewsUrl(rawUrl) || rawUrl;
  const title = (raw.title || '').trim();
  const content = (raw.content || '').trim();

  if (!title && !content) return null;

  const textForAnalysis = `${title} ${content}`;

  return {
    id: nanoid(),
    sourceId: source.id,
    externalId: raw.externalId || rawUrl,
    url,
    title,
    content: content.slice(0, 5000),
    author: raw.author ? { name: raw.author.name, handle: raw.author.handle } : null,
    language: detectLanguageHeuristic(textForAnalysis),
    tier: source.tier,
    publishedAt: raw.publishedAt || null,
    fetchedAt,
    entities: extractEntities(textForAnalysis),
    tags: (source.fetchConfig?.tags as string[]) || [],
    dedupHash: computeDedupHash(url, title),
  };
}

function decodeGoogleNewsUrl(url: string): string | null {
  if (!url.startsWith('CBMi')) {
    return null;
  }

  try {
    const decoded = Buffer.from(url, 'base64url').toString('latin1');
    const match = decoded.match(/https?:\/\/[^\s"'<>\\\x00-\x1F\x7F]+/i);
    return match?.[0] || null;
  } catch {
    return null;
  }
}

/** Simple language detection heuristic via Unicode ranges */
function detectLanguageHeuristic(text: string): string | null {
  if (!text || text.length < 20) return null;
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0;
  const japanese = text.match(/[\u3040-\u309f\u30a0-\u30ff]/g)?.length || 0;
  const korean = text.match(/[\uac00-\ud7af]/g)?.length || 0;
  const total = text.length;

  if (cjk / total > 0.1 && japanese === 0) return 'zh';
  if (japanese > 0) return 'ja';
  if (korean > 0) return 'ko';
  return 'en';
}

/** Entity extraction: rule-based matching against known entities */
function extractEntities(text: string): string[] {
  const found = new Set<string>();
  for (const entity of KNOWN_ENTITIES) {
    const regex = new RegExp(`\\b${escapeRegExp(entity)}\\b`, 'i');
    if (regex.test(text)) {
      found.add(entity);
    }
  }
  return [...found];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compute dedup hash: FNV-1a variant on normalized URL + title */
function computeDedupHash(url: string, title: string): string {
  const str = `${normalizeUrl(url)}|${title.toLowerCase().trim()}`;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    u.searchParams.delete('utm_content');
    u.searchParams.delete('utm_term');
    return u.href;
  } catch {
    return url;
  }
}

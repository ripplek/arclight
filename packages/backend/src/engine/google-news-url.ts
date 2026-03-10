import { logger } from '../shared/logger.js';

const GOOGLE_NEWS_HOST = 'news.google.com';
const GOOGLE_NEWS_UA = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/133.0.0.0 Safari/537.36',
].join(' ');
const GOOGLE_NEWS_LOCALE = 'US:en';
const REQUEST_TIMEOUT_MS = 20_000;

const decodeCache = new Map<string, Promise<string | null>>();

interface DecodeParams {
  signature: string;
  timestamp: string;
}

export function extractGoogleNewsArticleId(input: string): string | null {
  const value = input.trim();
  if (!value) {
    return null;
  }

  if (looksLikeGoogleNewsArticleId(value)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.hostname !== GOOGLE_NEWS_HOST) {
      return null;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    const articleIndex = parts.findIndex((part) => part === 'articles' || part === 'read');
    if (articleIndex === -1 || articleIndex === parts.length - 1) {
      return null;
    }

    const articleId = parts[articleIndex + 1];
    return looksLikeGoogleNewsArticleId(articleId) ? articleId : null;
  } catch {
    return null;
  }
}

export function isGoogleNewsEncodedUrl(input: string): boolean {
  return extractGoogleNewsArticleId(input) !== null;
}

export function toGoogleNewsArticleUrl(input: string): string | null {
  const articleId = extractGoogleNewsArticleId(input);
  if (!articleId) {
    return null;
  }

  return `https://${GOOGLE_NEWS_HOST}/articles/${articleId}`;
}

export function extractLegacyGoogleNewsUrl(input: string): string | null {
  const articleId = extractGoogleNewsArticleId(input);
  if (!articleId) {
    return null;
  }

  try {
    const decoded = Buffer.from(articleId, 'base64url').toString('latin1');
    const match = decoded.match(/https?:\/\/[^\s"'<>\\\x00-\x1F\x7F]+/i);
    return match?.[0] || null;
  } catch {
    return null;
  }
}

export async function decodeGoogleNewsUrl(input: string): Promise<string | null> {
  const articleId = extractGoogleNewsArticleId(input);
  if (!articleId) {
    return null;
  }

  const legacyUrl = extractLegacyGoogleNewsUrl(articleId);
  if (legacyUrl) {
    return legacyUrl;
  }

  const cached = decodeCache.get(articleId);
  if (cached) {
    return cached;
  }

  const task = (async () => {
    try {
      const params = await fetchDecodeParams(articleId);
      if (!params) {
        return null;
      }

      return await fetchDecodedUrl(articleId, params);
    } catch (error) {
      logger.warn({ error, articleId }, 'Google News URL decode failed');
      return null;
    }
  })();

  decodeCache.set(articleId, task);
  return task;
}

export async function resolveGoogleNewsUrl(input: string): Promise<string | null> {
  const decoded = await decodeGoogleNewsUrl(input);
  if (decoded) {
    return decoded;
  }

  return toGoogleNewsArticleUrl(input);
}

async function fetchDecodeParams(articleId: string): Promise<DecodeParams | null> {
  for (const path of ['articles', 'rss/articles', 'read']) {
    const html = await fetchGoogleNewsPageHtml(path, articleId);
    if (!html) {
      continue;
    }

    const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (signature && timestamp) {
      return { signature, timestamp };
    }
  }

  return null;
}

async function fetchGoogleNewsPageHtml(path: string, articleId: string): Promise<string | null> {
  const url = `https://${GOOGLE_NEWS_HOST}/${path}/${articleId}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': GOOGLE_NEWS_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    logger.debug({ articleId, path, status: response.status }, 'Google News article page fetch returned non-OK');
    return null;
  }

  return await response.text();
}

async function fetchDecodedUrl(articleId: string, params: DecodeParams): Promise<string | null> {
  const rpcPayload = [
    'Fbv4je',
    `[` +
      `"garturlreq",` +
      `[["X","X",["X","X"],null,null,1,1,"${GOOGLE_NEWS_LOCALE}",null,1,null,null,null,null,null,0,1],` +
      `"X","X",1,[1,1,1],1,1,null,0,0,null,0],` +
      `"${articleId}",${params.timestamp},"${params.signature}"` +
    `]`,
  ];

  const body = new URLSearchParams({
    'f.req': JSON.stringify([[rpcPayload]]),
  });

  const response = await fetch(`https://${GOOGLE_NEWS_HOST}/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': GOOGLE_NEWS_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    logger.debug({ articleId, status: response.status }, 'Google News batchexecute returned non-OK');
    return null;
  }

  const text = await response.text();
  return parseDecodedUrlFromBatchExecute(text);
}

export function parseDecodedUrlFromBatchExecute(text: string): string | null {
  const payload = text.split('\n\n')[1];
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as unknown[];
    const wrb = parsed.find(
      (entry): entry is [string, string, string] =>
        Array.isArray(entry) && entry[0] === 'wrb.fr' && typeof entry[2] === 'string',
    );

    if (!wrb) {
      return null;
    }

    const inner = JSON.parse(wrb[2]) as unknown[];
    const decodedUrl = inner[1];
    return typeof decodedUrl === 'string' ? decodedUrl : null;
  } catch (error) {
    logger.debug({ error }, 'Failed to parse Google News batchexecute response');
    return null;
  }
}

function looksLikeGoogleNewsArticleId(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,}$/.test(value) && (value.startsWith('CB') || value.startsWith('CA'));
}

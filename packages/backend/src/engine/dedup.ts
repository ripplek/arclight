// packages/backend/src/engine/dedup.ts
import type { NormalizedItem } from './normalizer.js';
import { logger } from '../shared/logger.js';

// Stop words to strip during token extraction
const EN_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'and', 'or', 'but', 'not', 'no', 'its', 'it', 'this', 'that',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'could', 'shall', 'up', 'out',
  'new', 'says', 'said', 'report', 'reports', 'after', 'over',
]);

// Chinese filler characters to strip
const ZH_STOP_CHARS = new Set([
  '的', '了', '在', '是', '将', '与', '和', '被', '把', '对',
  '也', '又', '就', '都', '而', '及', '着', '或', '等', '但',
  '已', '于', '之', '从', '向', '让', '给', '到', '用', '为',
]);

// Map Chinese number words to digits for normalization
const ZH_NUMBER_MAP: Record<string, string> = {
  '百': '100', '千': '1000', '万': '10000', '亿': '100000000',
  '十': '10', '两': '2', '三': '3', '四': '4', '五': '5',
  '六': '6', '七': '7', '八': '8', '九': '9',
};

/**
 * 去重引擎：
 * 1. 完全匹配：dedupHash 相同 → 保留更高 tier 的
 * 2. 模糊匹配：多信号综合相似度 > 阈值 → 聚类
 */
export function dedup(
  items: NormalizedItem[],
  options: { similarityThreshold?: number } = {},
): NormalizedItem[] {
  const threshold = options.similarityThreshold ?? 0.65;

  // Phase 1: exact dedup by hash
  const hashMap = new Map<string, NormalizedItem>();
  for (const item of items) {
    const existing = hashMap.get(item.dedupHash);
    if (!existing || item.tier < existing.tier) {
      hashMap.set(item.dedupHash, item);
    }
  }

  const uniqueByHash = [...hashMap.values()];

  // Phase 2: fuzzy dedup by multi-signal similarity
  const result: NormalizedItem[] = [];
  const clustered = new Set<string>();

  for (let i = 0; i < uniqueByHash.length; i++) {
    if (clustered.has(uniqueByHash[i].id)) continue;

    const current = uniqueByHash[i];
    result.push(current);

    for (let j = i + 1; j < uniqueByHash.length; j++) {
      if (clustered.has(uniqueByHash[j].id)) continue;

      const sim = itemSimilarity(current, uniqueByHash[j]);
      if (sim >= threshold) {
        clustered.add(uniqueByHash[j].id);
        logger.debug(
          { kept: current.title.slice(0, 40), dropped: uniqueByHash[j].title.slice(0, 40), sim: Math.round(sim * 100) / 100 },
          'Dedup: fuzzy match',
        );
      }
    }
  }

  logger.info({ before: items.length, afterHash: uniqueByHash.length, afterFuzzy: result.length }, 'Dedup complete');
  return result;
}

/**
 * Multi-signal item similarity:
 * 1. Character bigram Dice (original approach)
 * 2. Content-token Jaccard (word/char level after normalization)
 * 3. Entity overlap bonus
 */
function itemSimilarity(a: NormalizedItem, b: NormalizedItem): number {
  // Signal 1: character bigram Dice on titles
  const bigramSim = titleSimilarity(a.title, b.title);

  // Signal 2: token-level Jaccard on normalized titles
  const tokensA = extractContentTokens(a.title);
  const tokensB = extractContentTokens(b.title);
  const tokenSim = tokensA.size >= 2 && tokensB.size >= 2
    ? jaccardSimilarity(tokensA, tokensB)
    : 0;

  // Signal 3: entity overlap bonus (0 to 0.15)
  const entA = new Set(a.entities);
  const entB = new Set(b.entities);
  const entityBonus = entA.size > 0 && entB.size > 0
    ? jaccardSimilarity(entA, entB) * 0.15
    : 0;

  // Signal 4: shared-number boost — if both titles mention the same
  // specific number(s), add a small bonus
  const numsA = extractNumbers(a.title);
  const numsB = extractNumbers(b.title);
  const numberBonus = numsA.size > 0 && numsB.size > 0
    ? jaccardSimilarity(numsA, numsB) * 0.1
    : 0;

  return Math.min(1, Math.max(bigramSim, tokenSim) + entityBonus + numberBonus);
}

/**
 * Extract meaningful content tokens from a title.
 * English: split on whitespace/punctuation, remove stop words.
 * Chinese: extract individual CJK characters (each is a semantic unit),
 *          remove stop chars.
 * Numbers: extracted as separate tokens.
 */
function extractContentTokens(title: string): Set<string> {
  const stripped = stripPublisher(title).toLowerCase();
  const tokens = new Set<string>();

  // Extract numbers (including those after Chinese number words)
  for (const m of stripped.matchAll(/\d+/g)) {
    tokens.add(m[0]);
  }
  // Map standalone Chinese number words to digits
  for (const [zh, digit] of Object.entries(ZH_NUMBER_MAP)) {
    if (stripped.includes(zh)) tokens.add(digit);
  }

  // Extract English words
  for (const m of stripped.matchAll(/[a-z]{2,}/g)) {
    if (!EN_STOP_WORDS.has(m[0])) tokens.add(m[0]);
  }

  // Extract CJK characters as individual tokens
  for (const m of stripped.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]/g)) {
    if (!ZH_STOP_CHARS.has(m[0])) tokens.add(m[0]);
  }

  return tokens;
}

/** Extract all numbers (digit sequences) from text */
function extractNumbers(text: string): Set<string> {
  const nums = new Set<string>();
  for (const m of text.matchAll(/\d+/g)) {
    nums.add(m[0]);
  }
  // Also map Chinese number words
  for (const [zh, digit] of Object.entries(ZH_NUMBER_MAP)) {
    if (text.includes(zh)) nums.add(digit);
  }
  return nums;
}

/** Jaccard similarity: |A∩B| / |A∪B| */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Strip publisher suffix from title, e.g.:
 *   "Trump Demands Iran... - Bloomberg.com" → "Trump Demands Iran..."
 *   "AI News - The New York Times" → "AI News"
 */
function stripPublisher(title: string): string {
  // Match " - Publisher" or " | Publisher" at end of title
  return title.replace(/\s+[-–—|]\s+[A-Z][^\s-]{1,}(\s+[A-Z][^\s-]{0,}){0,5}\s*$/, '').trim();
}

/**
 * 标题相似度：Dice coefficient on bigrams
 */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  // Strip publisher suffixes before comparison
  const aNorm = stripPublisher(a).toLowerCase().trim();
  const bNorm = stripPublisher(b).toLowerCase().trim();

  if (aNorm === bNorm) return 1;

  const aBigrams = getBigrams(aNorm);
  const bBigrams = getBigrams(bNorm);

  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let intersection = 0;
  for (const bigram of aBigrams) {
    if (bBigrams.has(bigram)) intersection++;
  }

  return (2 * intersection) / (aBigrams.size + bBigrams.size);
}

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

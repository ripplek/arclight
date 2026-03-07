// packages/backend/src/engine/dedup.ts
import type { NormalizedItem } from './normalizer.js';
import { logger } from '../shared/logger.js';

/**
 * 去重引擎：
 * 1. 完全匹配：dedupHash 相同 → 保留更高 tier 的
 * 2. 模糊匹配：标题相似度 > 阈值 → 聚类
 */
export function dedup(
  items: NormalizedItem[],
  options: { similarityThreshold?: number } = {},
): NormalizedItem[] {
  const threshold = options.similarityThreshold ?? 0.7;

  // Phase 1: exact dedup by hash
  const hashMap = new Map<string, NormalizedItem>();
  for (const item of items) {
    const existing = hashMap.get(item.dedupHash);
    if (!existing || item.tier < existing.tier) {
      hashMap.set(item.dedupHash, item);
    }
  }

  const uniqueByHash = [...hashMap.values()];

  // Phase 2: fuzzy dedup by title similarity
  const result: NormalizedItem[] = [];
  const clustered = new Set<string>();

  for (let i = 0; i < uniqueByHash.length; i++) {
    if (clustered.has(uniqueByHash[i].id)) continue;

    const current = uniqueByHash[i];
    result.push(current);

    for (let j = i + 1; j < uniqueByHash.length; j++) {
      if (clustered.has(uniqueByHash[j].id)) continue;

      const sim = titleSimilarity(current.title, uniqueByHash[j].title);
      if (sim >= threshold) {
        clustered.add(uniqueByHash[j].id);
        logger.debug(
          { kept: current.title.slice(0, 40), dropped: uniqueByHash[j].title.slice(0, 40), sim },
          'Dedup: fuzzy match',
        );
      }
    }
  }

  logger.info({ before: items.length, afterHash: uniqueByHash.length, afterFuzzy: result.length }, 'Dedup complete');
  return result;
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

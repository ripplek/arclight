import type { RankedItem } from './ranking.js';
import type { EnhancedMeta } from './ai-enhance.js';
import { logger } from '../../shared/logger.js';

export interface SerendipityItem {
  /** The selected feed item */
  item: RankedItem;
  /** Optional AI-enhanced metadata for rendering */
  enhanced?: EnhancedMeta;
  /** One-liner explaining why this was picked */
  reason: string;
}

/**
 * Pick a serendipity item from ranked items.
 *
 * Strategy (MVP):
 * 1. Filter items where topicMatches is empty (non-topic-matched)
 * 2. Require score >= median of ALL ranked items (quality gate)
 * 3. Exclude items already in the top-N digest selection
 * 4. Randomly pick one
 * 5. Gracefully return null if no candidates
 */
export function pickSerendipityItem(
  allRankedItems: RankedItem[],
  digestItemIds: Set<string>,
): SerendipityItem | null {
  if (allRankedItems.length === 0) {
    return null;
  }

  // Calculate median score
  const scores = allRankedItems.map((i) => i.score).sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)];

  // Filter: no topic matches, score >= median, not already in digest
  const candidates = allRankedItems.filter(
    (item) =>
      item.topicMatches.length === 0 &&
      item.score >= median &&
      !digestItemIds.has(item.id),
  );

  if (candidates.length === 0) {
    logger.debug(
      { totalItems: allRankedItems.length, median },
      'Serendipity: no candidates found, skipping',
    );
    return null;
  }

  // Random pick
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  logger.info(
    {
      itemId: pick.id,
      title: pick.title?.slice(0, 60),
      score: pick.score,
      candidates: candidates.length,
      median,
    },
    'Serendipity: item selected',
  );

  return {
    item: pick,
    reason: buildReason(pick, candidates.length),
  };
}

function buildReason(item: RankedItem, poolSize: number): string {
  const parts: string[] = [];

  if (item.tier <= 2) {
    parts.push('来自高质量信源');
  }

  if (poolSize > 10) {
    parts.push(`从 ${poolSize} 条候选中随机选出`);
  }

  parts.push('不在你的常规关注话题内，但值得一看');

  return parts.join('，');
}

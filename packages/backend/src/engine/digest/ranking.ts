// packages/backend/src/engine/digest/ranking.ts

export interface RankedItem {
  id: string;
  sourceId: string;
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
  score: number;
  topicMatches: string[];
  contextInjection?: string;
}

export interface RankingOptions {
  topics: {
    name: string;
    keywords: string[];
    excludeKeywords?: string[];
    boost: number;
  }[];
  tierWeights: Record<string, number>;
  recencyHours: number;
}

/**
 * Ranking formula: score = tierWeight × topicBoost × recencyScore
 */
export function rankItems(
  items: Record<string, unknown>[],
  options: RankingOptions,
): RankedItem[] {
  const now = Date.now();

  const ranked: RankedItem[] = items.map((item) => {
    const tierWeight = options.tierWeights[String(item.tier)] ?? 1.0;
    const { boost: topicBoost, matches } = computeTopicBoost(item, options.topics);

    const publishedAt = item.publishedAt
      ? new Date(item.publishedAt as string | number | Date).getTime()
      : item.fetchedAt
        ? new Date(item.fetchedAt as string | number | Date).getTime()
        : now;
    const hoursAgo = (now - publishedAt) / (1000 * 60 * 60);
    const recencyScore = Math.exp(-hoursAgo / options.recencyHours);

    const score = tierWeight * topicBoost * recencyScore;

    return {
      id: item.id as string,
      sourceId: item.sourceId as string,
      url: item.url as string,
      title: (item.title as string) || '',
      content: (item.content as string) || '',
      author: item.author as RankedItem['author'],
      language: (item.language as string) || null,
      tier: item.tier as number,
      publishedAt: item.publishedAt ? new Date(item.publishedAt as string | number | Date) : null,
      fetchedAt: new Date((item.fetchedAt as string | number | Date) || now),
      entities: (item.entities as string[]) || [],
      tags: (item.tags as string[]) || [],
      score,
      topicMatches: matches,
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function computeTopicBoost(
  item: Record<string, unknown>,
  topics: RankingOptions['topics'],
): { boost: number; matches: string[] } {
  if (topics.length === 0) return { boost: 1.0, matches: [] };

  const text = `${(item.title as string) || ''} ${(item.content as string) || ''}`.toLowerCase();
  const entities = ((item.entities as string[]) || []).map((e: string) => e.toLowerCase());
  let totalBoost = 0;
  const matches: string[] = [];

  for (const topic of topics) {
    if (topic.excludeKeywords?.some((kw) => text.includes(kw.toLowerCase()))) {
      continue;
    }

    const hit = topic.keywords.some((kw) => {
      const kwLower = kw.toLowerCase();
      return text.includes(kwLower) || entities.includes(kwLower);
    });

    if (hit) {
      totalBoost += topic.boost;
      matches.push(topic.name);
    }
  }

  return {
    boost: Math.max(1.0, totalBoost === 0 ? 1.0 : totalBoost),
    matches,
  };
}

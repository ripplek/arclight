import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { storyArcs } from '../../db/schema.js';
import { ARC_CONFIG, type ArcSnapshot, type MatchRequest, type MatchResult } from './types.js';

export class ArcSnapshotCache {
  private cacheByUser = new Map<string, ArcSnapshot[]>();
  private lastRefreshAt = 0;
  private refreshPromise: Promise<void> | null = null;

  async refresh(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastRefreshAt < ARC_CONFIG.cacheRefreshMs) return;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const rows = await db
        .select({
          id: storyArcs.id,
          userId: storyArcs.userId,
          title: storyArcs.title,
          entities: storyArcs.entities,
          keywords: storyArcs.keywords,
          lastUpdated: storyArcs.lastUpdated,
        })
        .from(storyArcs)
        .where(and(eq(storyArcs.status, 'active'), isNull(storyArcs.mergedIntoId)));

      const next = new Map<string, ArcSnapshot[]>();
      for (const row of rows) {
        const snapshot: ArcSnapshot = {
          id: row.id,
          userId: row.userId,
          title: row.title,
          entities: normalizeTerms(row.entities ?? []),
          keywords: normalizeTerms(row.keywords ?? []),
          lastItemAt: row.lastUpdated ? new Date(row.lastUpdated).getTime() : 0,
          titleBigrams: createBigrams(normalizeTitle(row.title)),
        };

        const list = next.get(row.userId) ?? [];
        list.push(snapshot);
        next.set(row.userId, list);
      }

      for (const list of next.values()) {
        list.sort((a, b) => b.lastItemAt - a.lastItemAt);
      }

      this.cacheByUser = next;
      this.lastRefreshAt = Date.now();
    })()
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  getUserArcs(userId: string): ArcSnapshot[] {
    return this.cacheByUser.get(userId) ?? [];
  }

  upsert(snapshot: Omit<ArcSnapshot, 'titleBigrams'>): void {
    const list = this.cacheByUser.get(snapshot.userId) ?? [];
    const nextSnapshot: ArcSnapshot = {
      ...snapshot,
      titleBigrams: createBigrams(normalizeTitle(snapshot.title)),
    };
    const idx = list.findIndex((arc) => arc.id === snapshot.id);
    if (idx === -1) {
      list.push(nextSnapshot);
    } else {
      list[idx] = nextSnapshot;
    }
    list.sort((a, b) => b.lastItemAt - a.lastItemAt);
    this.cacheByUser.set(snapshot.userId, list);
  }

  remove(userId: string, arcId: string): void {
    const list = this.cacheByUser.get(userId);
    if (!list) return;
    this.cacheByUser.set(
      userId,
      list.filter((arc) => arc.id !== arcId),
    );
  }
}

const cache = new ArcSnapshotCache();

export function getArcSnapshotCache(): ArcSnapshotCache {
  return cache;
}

export async function findBestMatch(item: MatchRequest): Promise<MatchResult | null> {
  await cache.refresh();
  const arcs = cache.getUserArcs(item.userId);
  if (arcs.length === 0) return null;

  const itemEntities = new Set(normalizeTerms(item.entities));
  const itemTitleBigrams = createBigrams(normalizeTitle(item.title));

  let bestArcId: string | null = null;
  let bestScore = 0;

  for (const arc of arcs) {
    const arcTerms = new Set([...arc.entities, ...arc.keywords]);
    const entityScore = jaccard(itemEntities, arcTerms);
    const titleScore = dice(itemTitleBigrams, arc.titleBigrams);
    const hoursSinceLast = Math.max(0, (item.occurredAt - arc.lastItemAt) / (1000 * 60 * 60));
    const timeScore = Math.exp(-hoursSinceLast / ARC_CONFIG.matchTimeDecayHours);

    const score =
      entityScore * ARC_CONFIG.matchWeights.entity +
      titleScore * ARC_CONFIG.matchWeights.title +
      timeScore * ARC_CONFIG.matchWeights.timeDecay;

    if (score > bestScore) {
      bestScore = score;
      bestArcId = arc.id;
    }
  }

  if (!bestArcId || bestScore < ARC_CONFIG.matchThreshold) {
    return null;
  }

  return {
    arcId: bestArcId,
    score: Number(bestScore.toFixed(4)),
  };
}

function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const term of terms) {
    const normalized = normalizeTerm(term);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeTerm(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeTitle(title: string): string {
  return title
    .replace(/\s+[-–—|]\s+[^-–—|]{1,80}$/, '')
    .toLowerCase()
    .trim();
}

function createBigrams(text: string): Set<string> {
  const set = new Set<string>();
  if (text.length < 2) return set;
  for (let i = 0; i < text.length - 1; i++) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection++;
  }
  return (2 * intersection) / (a.size + b.size);
}

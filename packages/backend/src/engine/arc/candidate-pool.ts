import { ARC_CONFIG, type CandidateGroup, type CandidateItem } from './types.js';

export class CandidatePool {
  private userCandidates = new Map<string, CandidateItem[]>();

  add(userId: string, candidate: CandidateItem): void {
    if (candidate.entities.length === 0) return;

    const list = this.userCandidates.get(userId) ?? [];
    const exists = list.some((item) => item.itemId === candidate.itemId);
    if (!exists) {
      list.push(candidate);
      this.userCandidates.set(userId, list);
    }

    this.cleanupUser(userId);
  }

  takeReadyGroup(userId: string): CandidateGroup | null {
    this.cleanupUser(userId);
    const list = this.userCandidates.get(userId) ?? [];
    if (list.length < ARC_CONFIG.candidateMinItems) return null;

    const now = Date.now();
    const windowStart = now - ARC_CONFIG.candidateWindowMs;
    const activeItems = list.filter((item) => item.seenAt >= windowStart);
    if (activeItems.length < ARC_CONFIG.candidateMinItems) return null;

    const byEntity = new Map<string, CandidateItem[]>();
    for (const item of activeItems) {
      const uniqueEntities = [...new Set(item.entities)];
      for (const entity of uniqueEntities) {
        const bucket = byEntity.get(entity) ?? [];
        bucket.push(item);
        byEntity.set(entity, bucket);
      }
    }

    for (const [entity, itemsForEntity] of byEntity.entries()) {
      const uniqueItems = dedupeByItem(itemsForEntity);
      if (uniqueItems.length < ARC_CONFIG.candidateMinItems) continue;

      const sourceCount = new Set(uniqueItems.map((item) => item.sourceId)).size;
      if (sourceCount < ARC_CONFIG.candidateMinSources) continue;

      const sharedEntities = collectSharedEntities(uniqueItems);
      if (sharedEntities.length === 0) {
        sharedEntities.push(entity);
      }

      const selected = uniqueItems.sort((a, b) => a.seenAt - b.seenAt);
      this.removeCandidates(userId, new Set(selected.map((item) => item.itemId)));
      return { items: selected, sharedEntities };
    }

    return null;
  }

  cleanupExpiredCandidates(): void {
    for (const userId of this.userCandidates.keys()) {
      this.cleanupUser(userId);
    }
  }

  private cleanupUser(userId: string): void {
    const list = this.userCandidates.get(userId) ?? [];
    if (list.length === 0) return;
    const cutoff = Date.now() - ARC_CONFIG.candidateExpiryMs;
    const next = list.filter((item) => item.seenAt >= cutoff);
    if (next.length === 0) {
      this.userCandidates.delete(userId);
    } else {
      this.userCandidates.set(userId, next);
    }
  }

  private removeCandidates(userId: string, consumedIds: Set<string>): void {
    const list = this.userCandidates.get(userId) ?? [];
    const next = list.filter((item) => !consumedIds.has(item.itemId));
    if (next.length === 0) {
      this.userCandidates.delete(userId);
    } else {
      this.userCandidates.set(userId, next);
    }
  }
}

const pool = new CandidatePool();

export function getCandidatePool(): CandidatePool {
  return pool;
}

function dedupeByItem(items: CandidateItem[]): CandidateItem[] {
  const seen = new Set<string>();
  const result: CandidateItem[] = [];
  for (const item of items) {
    if (seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    result.push(item);
  }
  return result;
}

function collectSharedEntities(items: CandidateItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const entity of new Set(item.entities)) {
      counts.set(entity, (counts.get(entity) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= ARC_CONFIG.candidateMinItems)
    .sort((a, b) => b[1] - a[1])
    .map(([entity]) => entity);
}

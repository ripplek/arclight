export const ARC_CONFIG = {
  cacheRefreshMs: 5 * 60 * 1000,
  matchThreshold: 0.4,
  matchWeights: {
    entity: 0.5,
    title: 0.3,
    timeDecay: 0.2,
  },
  matchTimeDecayHours: 72,
  candidateWindowMs: 24 * 60 * 60 * 1000,
  candidateExpiryMs: 48 * 60 * 60 * 1000,
  candidateMinItems: 2,
  candidateMinSources: 2,
  activeToStaleMs: 48 * 60 * 60 * 1000,
  staleToArchivedMs: 7 * 24 * 60 * 60 * 1000,
  archivedRetentionMs: 90 * 24 * 60 * 60 * 1000,
} as const;

export type ArcStatus = 'active' | 'stale' | 'archived';

export interface ArcSnapshot {
  id: string;
  userId: string;
  title: string;
  entities: string[];
  keywords: string[];
  lastItemAt: number;
  titleBigrams: Set<string>;
}

export interface MatchRequest {
  userId: string;
  title: string;
  entities: string[];
  sourceId: string;
  occurredAt: number;
}

export interface MatchResult {
  arcId: string;
  score: number;
}

export interface ArcProcessItem {
  id: string;
  sourceId: string;
  title: string;
  content?: string;
  entities?: string[];
  publishedAt?: Date | null;
  fetchedAt?: Date | null;
}

export interface CandidateItem {
  itemId: string;
  title: string;
  sourceId: string;
  entities: string[];
  seenAt: number;
}

export interface CandidateGroup {
  items: CandidateItem[];
  sharedEntities: string[];
}

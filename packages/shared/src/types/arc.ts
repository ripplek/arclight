// ═══════════════════════════════════════════
// Story Arc Types
// ═══════════════════════════════════════════

export type ArcStatus = 'active' | 'stale' | 'archived';

export type ArcTitleSource = 'rule' | 'llm' | 'user';

export interface ArcTimelineEntry {
  date: string;
  headline: string;
  itemId: string;
}

export interface StoryArc {
  id: string;
  userId: string;
  title: string;
  summary?: string;
  tags: string[];
  entities: string[];
  keywords: string[];
  status: ArcStatus;
  firstSeen: Date;
  lastUpdated: Date;
  summaryUpdatedAt?: Date;
  titleSource: ArcTitleSource;
  mergedIntoId?: string;
  itemCount: number;
  sourceCount: number;
  buzzScore: number;
  timeline?: ArcTimelineEntry[];
  createdAt: Date;
  updatedAt: Date;
}

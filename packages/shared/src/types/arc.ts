// ═══════════════════════════════════════════
// Story Arc Types
// ═══════════════════════════════════════════

export type ArcStatus = 'active' | 'dormant' | 'closed';

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
  status: ArcStatus;
  firstSeen: Date;
  lastUpdated: Date;
  itemCount: number;
  timeline?: ArcTimelineEntry[];
}

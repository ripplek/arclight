// ═══════════════════════════════════════════
// Digest Types
// ═══════════════════════════════════════════

export type DigestTier = 'flash' | 'daily' | 'deep' | 'weekly' | 'buzz' | 'alert';

export interface DigestOutput {
  id: string;
  userId: string;
  tier: DigestTier;
  date: string;
  contentMarkdown: string;
  contentHtml?: string;
  itemIds: string[];
  arcIds?: string[];
  metadata: {
    itemCount: number;
    generatedAt: string;
    llmCost?: number;
    pipelineDurationMs?: number;
  };
}

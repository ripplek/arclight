// ═══════════════════════════════════════════
// Source Tier System
// ═══════════════════════════════════════════

/** T1=一手源, T2=权威媒体, T3=垂类专业, T4=聚合/社区 */
export type SourceTier = 1 | 2 | 3 | 4;

export const SOURCE_TIERS = {
  1: { label: '一手源', description: '官方、通讯社、当事方', weight: 2.0 },
  2: { label: '权威媒体', description: '主流媒体、深度报道', weight: 1.5 },
  3: { label: '专业/垂类', description: '行业媒体、技术博客', weight: 1.0 },
  4: { label: '聚合/社区', description: '社交平台、论坛', weight: 0.7 },
} as const satisfies Record<SourceTier, { label: string; description: string; weight: number }>;

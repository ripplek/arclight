# Story Arc — 技术架构文档

**角色**：系统架构设计（ArcLight Story Arc 功能）  
**作者**：Opus（系统架构师）  
**日期**：2026-03-08  
**状态**：Draft v1.0  
**前置**：基于 ARCHITECTURE.md v1.0，与现有 Hono + Drizzle + SQLite 架构一致

---

## 目录

1. [Executive Summary](#1-executive-summary)
2. [数据模型](#2-数据模型)
3. [Arc 聚合引擎](#3-arc-聚合引擎)
4. [Arc 生命周期管理](#4-arc-生命周期管理)
5. [LLM 集成](#5-llm-集成)
6. [Buzz Signal（跨源热度检测）](#6-buzz-signal跨源热度检测)
7. [API 设计](#7-api-设计)
8. [Digest 集成](#8-digest-集成)
9. [前端页面方案](#9-前端页面方案)
10. [采集 Pipeline 集成](#10-采集-pipeline-集成)
11. [MVP 范围与工时预估](#11-mvp-范围与工时预估)

---

## 1. Executive Summary

### 1.1 什么是 Story Arc

Story Arc 将 ArcLight 从"新闻聚合"升级为"故事追踪"——自动将零散新闻聚合成完整的故事线，让用户追踪事件的来龙去脉。

**核心用例：**

| 场景 | 效果 |
|------|------|
| "中东冲突" | 冲突报道 → 升级 → 停火谈判 → 协议签署，自动串成时间线 |
| "OpenAI 产品发布" | GPT-5 泄露 → 发布 → 开发者反应 → 竞品回应，完整追踪 |
| "特斯拉财报季" | 财报预告 → 发布 → 股价反应 → 分析师报告 |

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| **实时嵌入** | Arc 匹配在采集 pipeline 中实时进行，不是独立的批处理 |
| **LLM 经济** | 用 frugalai 代理，无 tool_use 能力，必须有纯文本 fallback |
| **渐进增强** | 无 LLM 时用规则匹配，有 LLM 时质量更高 |
| **不拖慢采集** | 1000+ items/天的规模下，Arc 匹配不能成为瓶颈 |
| **与现有架构一致** | Hono + Drizzle + SQLite，复用现有 LLMClient / dedup / 等模块 |

### 1.3 关键架构决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Arc 匹配时机 | 采集 pipeline 内实时 | 确保每条新闻立即归入正确的 Arc |
| Entity 提取 | 规则优先 + LLM 异步增强 | 规则提取零延迟，LLM 提取延后但更精确 |
| 相似度算法 | Entity 重叠 + 标题 bigram + 时间窗口 | 多信号加权，比单一算法更鲁棒 |
| Arc 摘要 | LLM 异步生成，有新 item 时延迟更新 | 不阻塞采集流程，摘要可 stale 一段时间 |
| Buzz 检测 | 与 Arc 共享 entity 索引，滑动时间窗口 | 复用已有 entity 数据，避免重复计算 |

---

## 2. 数据模型

### 2.1 现有 Schema 评估

当前 schema 中已有 `storyArcs` 和 `arcItems` 表的雏形。需要增强以支持完整的 Story Arc 功能。

### 2.2 增强后的 Drizzle Schema

```typescript
// packages/backend/src/db/schema.ts — Story Arc 相关表（增强版）

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ═══════════════════════════════════════════
// Story Arcs（增强版）
// ═══════════════════════════════════════════

export const storyArcs = sqliteTable('story_arcs', {
  id: text('id').primaryKey(),                                  // nanoid
  userId: text('user_id').notNull().references(() => users.id),
  
  // --- 核心内容 ---
  title: text('title').notNull(),                               // LLM 生成或规则拼接
  summary: text('summary'),                                     // LLM 生成的故事线摘要
  
  // --- Entity & 标签 ---
  entities: text('entities', { mode: 'json' })
    .$type<string[]>().default([]),                              // 关键实体列表
  keywords: text('keywords', { mode: 'json' })
    .$type<string[]>().default([]),                              // 匹配关键词（比 entities 更宽泛）
  tags: text('tags', { mode: 'json' })
    .$type<string[]>().default([]),                              // 用户标签
  
  // --- 生命周期 ---
  status: text('status', { 
    enum: ['active', 'stale', 'archived'] 
  }).notNull().default('active'),
  
  // --- 时间线元数据 ---
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull(),
  lastItemAt: integer('last_item_at', { mode: 'timestamp' }).notNull(),  // 最后一条 item 的加入时间
  
  // --- 统计 ---
  itemCount: integer('item_count').notNull().default(0),
  sourceCount: integer('source_count').notNull().default(0),    // 覆盖的不同源数量
  buzzScore: real('buzz_score').default(0),                     // 当前 buzz 得分
  
  // --- LLM 增强元数据 ---
  summaryUpdatedAt: integer('summary_updated_at', { mode: 'timestamp' }), // 上次摘要更新时间
  titleSource: text('title_source', { 
    enum: ['rule', 'llm'] 
  }).default('rule'),                                           // 标题来源
  
  // --- 合并支持 ---
  mergedIntoId: text('merged_into_id'),                         // 如果被合并，指向目标 Arc
  
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  statusIdx: index('idx_story_arcs_status').on(table.status),
  userStatusIdx: index('idx_story_arcs_user_status').on(table.userId, table.status),
  lastItemIdx: index('idx_story_arcs_last_item').on(table.lastItemAt),
  buzzIdx: index('idx_story_arcs_buzz').on(table.buzzScore),
}));

// ═══════════════════════════════════════════
// Arc Items 关联表（增强版）
// ═══════════════════════════════════════════

export const arcItems = sqliteTable('arc_items', {
  id: text('id').primaryKey(),                                  // nanoid
  arcId: text('arc_id').notNull().references(() => storyArcs.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => feedItems.id),
  
  // --- 位置与重要性 ---
  relevanceScore: real('relevance_score').default(1.0),         // 与 Arc 的相关度
  isKeyEvent: integer('is_key_event', { mode: 'boolean' }).default(false), // 关键节点标记
  
  // --- 时间线标注 ---
  headline: text('headline'),                                   // 该 item 在时间线中的一句话标题
  
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  arcItemUnique: uniqueIndex('idx_arc_items_unique').on(table.arcId, table.itemId),
  arcIdx: index('idx_arc_items_arc').on(table.arcId),
  itemIdx: index('idx_arc_items_item').on(table.itemId),
}));

// ═══════════════════════════════════════════
// Buzz Events（新表 — MVP Phase 2）
// ═══════════════════════════════════════════

export const buzzEvents = sqliteTable('buzz_events', {
  id: text('id').primaryKey(),
  
  // --- 关联 ---
  arcId: text('arc_id').references(() => storyArcs.id),         // 可能触发的 Arc
  
  // --- 信号数据 ---
  entityCluster: text('entity_cluster', { mode: 'json' })
    .$type<string[]>().notNull(),                               // 触发 buzz 的实体集合
  sourceIds: text('source_ids', { mode: 'json' })
    .$type<string[]>().notNull(),                               // 涉及的源
  itemIds: text('item_ids', { mode: 'json' })
    .$type<string[]>().notNull(),                               // 涉及的 items
  
  score: real('score').notNull(),                               // buzz 强度
  windowStart: integer('window_start', { mode: 'timestamp' }).notNull(),
  windowEnd: integer('window_end', { mode: 'timestamp' }).notNull(),
  
  // --- 状态 ---
  alerted: integer('alerted', { mode: 'boolean' }).default(false), // 是否已推送 alert
  
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  scoreIdx: index('idx_buzz_events_score').on(table.score),
  createdIdx: index('idx_buzz_events_created').on(table.createdAt),
}));
```

### 2.3 ER 关系图

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   users      │     │ feed_sources │     │  feed_items   │
│              │     │              │     │              │
│  id ─────────┼──┐  │  id          │──┐  │  id          │
│  ...         │  │  │  ...         │  │  │  sourceId ───┼── → feed_sources.id
└──────────────┘  │  └──────────────┘  │  │  entities []  │
                  │                    │  │  buzzData {}   │
                  │                    │  │  ...          │
                  │                    │  └──────┬───────┘
                  │                    │         │
                  │  ┌──────────────┐  │  ┌──────┴───────┐
                  │  │  story_arcs  │  │  │  arc_items   │
                  │  │              │  │  │              │
                  └──┤  userId      │  │  │  arcId ──────┼── → story_arcs.id
                     │  entities [] │  │  │  itemId ─────┼── → feed_items.id
                     │  status      │  │  │  relevance   │
                     │  buzzScore   │  │  │  headline    │
                     │  ...         │  │  └──────────────┘
                     └──────┬───────┘  │
                            │          │
                     ┌──────┴───────┐  │
                     │ buzz_events  │  │
                     │              │  │
                     │  arcId ──────┼──┘ (optional)
                     │  entityCluster│
                     │  sourceIds [] │
                     │  score       │
                     └──────────────┘
                     
┌──────────────┐
│   digests    │
│              │
│  arcIds [] ──┼── → story_arcs.id[] (JSON)
│  ...         │
└──────────────┘
```

### 2.4 与现有表的关系

| 现有表 | 关系 | 说明 |
|--------|------|------|
| `feed_items` | 多对多（via `arc_items`） | 一条新闻可属于多个 Arc |
| `feed_items.entities` | 共享 entity 索引 | Arc 匹配依赖 item 的 entity 字段 |
| `feed_items.buzzData` | Buzz 数据来源 | 已有字段继续用于 item 级别的 buzz |
| `digests` | 引用（`arcIds` JSON 字段） | Digest 已有 `arcIds` 字段，直接复用 |
| `user_preferences` | 配置 | 已有 `ranking.arcActiveBoost` 字段 |

### 2.5 Migration 策略

现有 schema 中的 `storyArcs` 和 `arcItems` 需要通过 Drizzle migration 增量修改：

```typescript
// drizzle/migrations/xxxx_story_arc_enhance.ts

// 1. story_arcs 表：新增字段
//    - keywords (json)
//    - source_count (integer)
//    - buzz_score (real)
//    - summary_updated_at (integer)
//    - title_source (text)
//    - merged_into_id (text)
//    - updated_at (integer)
//    重命名：firstSeen → first_seen_at, lastUpdated → last_item_at
//    删除：position, timeline (JSON 移入 arc_items)

// 2. arc_items 表：新增字段
//    - relevance_score (real)
//    - is_key_event (integer)
//    - headline (text)
//    添加 unique index: (arc_id, item_id)

// 3. 新建 buzz_events 表（Phase 2）
```

---

## 3. Arc 聚合引擎

### 3.1 总体架构

Arc 聚合引擎嵌入到现有的采集 pipeline 中，在 `storeItems()` 之后立即执行：

```
fetch → normalize → dedup → store → ★ arcMatch → (async) arcEnhance
```

关键设计：`arcMatch` 是同步的、轻量的；`arcEnhance`（LLM 增强）是异步的、延迟的。

### 3.2 匹配算法

#### 3.2.1 多信号加权匹配

```typescript
// packages/backend/src/engine/arc/matcher.ts

interface ArcMatchResult {
  arcId: string | null;     // 匹配到的 Arc ID（null = 无匹配）
  score: number;            // 综合匹配分数 0-1
  isNewArc: boolean;        // 是否应创建新 Arc
  reason: string;           // 匹配原因（调试用）
}

/**
 * 核心匹配算法：对每条新入库的 item，判断是否属于已有 Arc
 * 
 * 输入：新 item + 当前所有 active Arc
 * 输出：最佳匹配的 Arc，或"应创建新 Arc"的建议
 */
function matchItemToArc(
  item: { title: string; entities: string[]; publishedAt: Date | null; sourceId: string },
  activeArcs: ArcSnapshot[],
  config: MatchConfig,
): ArcMatchResult {
  
  let bestMatch: { arcId: string; score: number; reason: string } | null = null;
  
  for (const arc of activeArcs) {
    const score = computeMatchScore(item, arc, config);
    
    if (score >= config.matchThreshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { 
        arcId: arc.id, 
        score, 
        reason: `entity_overlap=${entityOverlap}, title_sim=${titleSim}` 
      };
    }
  }
  
  if (bestMatch) {
    return { arcId: bestMatch.arcId, score: bestMatch.score, isNewArc: false, reason: bestMatch.reason };
  }
  
  return { arcId: null, score: 0, isNewArc: false, reason: 'no_match' };
}

interface MatchConfig {
  matchThreshold: number;         // 最低匹配分数，默认 0.4
  entityWeight: number;           // Entity 重叠权重，默认 0.5
  titleWeight: number;            // 标题相似度权重，默认 0.3
  timeDecayWeight: number;        // 时间衰减权重，默认 0.2
  timeWindowHours: number;        // 时间窗口（小时），默认 168 (7天)
}

const DEFAULT_MATCH_CONFIG: MatchConfig = {
  matchThreshold: 0.4,
  entityWeight: 0.5,
  titleWeight: 0.3,
  timeDecayWeight: 0.2,
  timeWindowHours: 168,
};
```

#### 3.2.2 匹配分数计算

```typescript
/**
 * 计算 item 与 arc 的匹配分数
 * 
 * score = entityWeight × entityOverlap 
 *       + titleWeight × titleSimilarity 
 *       + timeDecayWeight × timeProximity
 */
function computeMatchScore(
  item: { title: string; entities: string[]; publishedAt: Date | null },
  arc: ArcSnapshot,
  config: MatchConfig,
): number {
  // 1. Entity 重叠度 (Jaccard coefficient)
  const itemEntities = new Set(item.entities.map(e => e.toLowerCase()));
  const arcEntities = new Set(arc.entities.map(e => e.toLowerCase()));
  
  let intersection = 0;
  for (const e of itemEntities) {
    if (arcEntities.has(e)) intersection++;
  }
  
  const union = new Set([...itemEntities, ...arcEntities]).size;
  const entityOverlap = union === 0 ? 0 : intersection / union;
  
  // 要求至少有 1 个 entity 重叠才算有意义
  if (intersection === 0 && itemEntities.size > 0 && arcEntities.size > 0) {
    return 0;
  }
  
  // 2. 标题相似度（复用已有的 titleSimilarity 函数）
  // 与 Arc 中最近 5 条 item 的标题做比较，取最高分
  const titleSim = Math.max(
    ...arc.recentTitles.map(t => titleSimilarity(item.title, t)),
    0,
  );
  
  // 3. 时间衰减（item 时间与 Arc 最后更新时间越近越好）
  const itemTime = item.publishedAt?.getTime() ?? Date.now();
  const arcLastTime = arc.lastItemAt.getTime();
  const hoursDiff = Math.abs(itemTime - arcLastTime) / (1000 * 60 * 60);
  const timeProximity = Math.exp(-hoursDiff / config.timeWindowHours);
  
  // 加权求和
  const score = 
    config.entityWeight * entityOverlap +
    config.titleWeight * titleSim +
    config.timeDecayWeight * timeProximity;
  
  return score;
}
```

#### 3.2.3 Arc 快照缓存

为避免每次匹配都查询数据库，维护内存中的 active Arc 快照：

```typescript
/**
 * Active Arc 的内存快照，用于快速匹配
 */
interface ArcSnapshot {
  id: string;
  userId: string;
  entities: string[];             // 所有 entities 的并集
  keywords: string[];
  recentTitles: string[];         // 最近 5 条 item 的标题
  lastItemAt: Date;
  sourceIds: Set<string>;         // 已覆盖的源
  itemCount: number;
}

class ArcSnapshotCache {
  private cache = new Map<string, ArcSnapshot[]>();  // userId → snapshots
  private lastRefresh = 0;
  private refreshIntervalMs = 5 * 60 * 1000;  // 每 5 分钟从 DB 刷新一次
  
  /**
   * 获取用户的 active Arc 快照
   * 热路径：直接返回内存缓存
   * 冷路径：从 DB 加载
   */
  async getActiveArcs(userId: string): Promise<ArcSnapshot[]> {
    if (Date.now() - this.lastRefresh > this.refreshIntervalMs) {
      await this.refresh();
    }
    return this.cache.get(userId) ?? [];
  }
  
  /**
   * 当 Arc 被修改时，立即更新缓存（不等下次 refresh）
   */
  updateArc(userId: string, snapshot: ArcSnapshot): void {
    const arcs = this.cache.get(userId) ?? [];
    const idx = arcs.findIndex(a => a.id === snapshot.id);
    if (idx >= 0) {
      arcs[idx] = snapshot;
    } else {
      arcs.push(snapshot);
    }
    this.cache.set(userId, arcs);
  }
  
  private async refresh(): Promise<void> {
    // 查询所有 active Arc + 最近的 recentTitles
    // ... DB query ...
    this.lastRefresh = Date.now();
  }
}
```

### 3.3 新 Arc 创建策略

新 Arc 不会因单条新闻创建，需要满足"跨源聚合"条件：

```typescript
/**
 * 新 Arc 创建条件：
 * 1. 至少 N 条来自不同源的相关新闻（默认 N=2）
 * 2. 这些新闻在时间窗口内（默认 24h）
 * 3. 它们共享至少 1 个 entity
 * 
 * 实现方式：维护一个"候选池"（pending buffer），
 * 当新 item 无法匹配已有 Arc 时，进入候选池。
 * 候选池中的 items 定期检查是否满足创建条件。
 */

interface PendingItem {
  itemId: string;
  userId: string;
  title: string;
  entities: string[];
  sourceId: string;
  publishedAt: Date;
  addedAt: Date;
}

class ArcCandidatePool {
  private pending: PendingItem[] = [];
  private readonly MIN_SOURCES = 2;      // 至少来自 2 个不同源
  private readonly MIN_ITEMS = 2;         // 至少 2 条 item
  private readonly WINDOW_HOURS = 24;     // 24h 时间窗口
  private readonly POOL_TTL_HOURS = 48;   // 候选池中 item 的最大存活时间
  
  /**
   * 新 item 进入候选池后，检查是否可以创建 Arc
   */
  addAndCheck(item: PendingItem): ArcCreationCandidate | null {
    this.pending.push(item);
    this.evictStale();
    
    // 查找与当前 item 共享 entity 的候选
    const cluster = this.findEntityCluster(item);
    
    if (cluster.length >= this.MIN_ITEMS) {
      const uniqueSources = new Set(cluster.map(c => c.sourceId));
      if (uniqueSources.size >= this.MIN_SOURCES) {
        // 从候选池中移除这些 items
        const clusterIds = new Set(cluster.map(c => c.itemId));
        this.pending = this.pending.filter(p => !clusterIds.has(p.itemId));
        
        return {
          items: cluster,
          sharedEntities: this.getSharedEntities(cluster),
          suggestedTitle: this.generateRuleBasedTitle(cluster),
        };
      }
    }
    
    return null;
  }
  
  private findEntityCluster(target: PendingItem): PendingItem[] {
    const targetEntities = new Set(target.entities.map(e => e.toLowerCase()));
    const windowStart = Date.now() - this.WINDOW_HOURS * 60 * 60 * 1000;
    
    return this.pending.filter(p => {
      if (p.publishedAt.getTime() < windowStart) return false;
      if (p.userId !== target.userId) return false;
      
      // 至少有 1 个 entity 重叠
      return p.entities.some(e => targetEntities.has(e.toLowerCase()));
    });
  }
  
  private getSharedEntities(cluster: PendingItem[]): string[] {
    if (cluster.length === 0) return [];
    
    // 找出出现在至少 2 条 item 中的 entities
    const counts = new Map<string, number>();
    for (const item of cluster) {
      for (const e of item.entities) {
        counts.set(e.toLowerCase(), (counts.get(e.toLowerCase()) ?? 0) + 1);
      }
    }
    
    return [...counts.entries()]
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([entity]) => entity);
  }
  
  private generateRuleBasedTitle(cluster: PendingItem[]): string {
    // 规则：取共享实体 + "相关报道"
    const entities = this.getSharedEntities(cluster);
    if (entities.length > 0) {
      return entities.slice(0, 3).join(' / ');
    }
    // fallback：取第一条新闻标题的前 20 字
    return cluster[0].title.slice(0, 20) + '...';
  }
  
  private evictStale(): void {
    const cutoff = Date.now() - this.POOL_TTL_HOURS * 60 * 60 * 1000;
    this.pending = this.pending.filter(p => p.addedAt.getTime() > cutoff);
  }
}
```

### 3.4 Arc 合并策略

两个 Arc 可能实际讲的是同一件事，需要合并：

```typescript
/**
 * Arc 合并检测：定期（每小时）扫描 active Arcs，
 * 检测是否有应该合并的 Arc
 * 
 * 合并条件：
 * 1. Entity Jaccard 相似度 > 0.6
 * 2. 且有至少 1 条共享 item（同时属于两个 Arc）
 * 
 * 合并行为：
 * - 保留 itemCount 更多的 Arc 作为主 Arc
 * - 将副 Arc 的所有 items 迁移到主 Arc
 * - 副 Arc 标记 mergedIntoId = 主 Arc id
 * - 副 Arc status 设为 archived
 */

async function checkAndMergeArcs(userId: string): Promise<number> {
  const activeArcs = await getActiveArcsWithItems(userId);
  let mergeCount = 0;
  
  for (let i = 0; i < activeArcs.length; i++) {
    for (let j = i + 1; j < activeArcs.length; j++) {
      const a = activeArcs[i];
      const b = activeArcs[j];
      
      // 已被合并的跳过
      if (a.mergedIntoId || b.mergedIntoId) continue;
      
      const entitySim = jaccardSimilarity(a.entities, b.entities);
      const sharedItems = a.itemIds.filter(id => b.itemIds.includes(id));
      
      if (entitySim > 0.6 || sharedItems.length >= 1) {
        // 保留更大的 Arc
        const [primary, secondary] = a.itemCount >= b.itemCount ? [a, b] : [b, a];
        await mergeArc(secondary.id, primary.id);
        mergeCount++;
      }
    }
  }
  
  return mergeCount;
}
```

### 3.5 Entity 提取策略

分两层：快速规则提取（同步）+ LLM 增强提取（异步）

```typescript
/**
 * 第一层：规则提取（零延迟，在 normalizer 中已实现）
 * - 匹配 KNOWN_ENTITIES 列表（已有 ~40 个实体）
 * - 扩展为 ~200 个常见实体（人名、公司、产品、地名）
 * 
 * 第二层：LLM 增强提取（异步，在 arcEnhance 中实现）
 * - 调用 LLM 从标题+摘要提取实体
 * - 更新 item 的 entities 字段
 * - 重新运行 Arc 匹配（可能发现新关联）
 */

// 扩展的 KNOWN_ENTITIES（示例片段）
const EXTENDED_ENTITIES: Record<string, string[]> = {
  // 科技公司
  tech: [
    'OpenAI', 'Anthropic', 'Google', 'Apple', 'Microsoft', 'Meta', 'Amazon',
    'Tesla', 'NVIDIA', 'SpaceX', 'DeepMind', 'Mistral', 'xAI', 'ByteDance',
    'Tencent', 'Alibaba', 'Samsung', 'Intel', 'AMD', 'Qualcomm', 'ARM', 'TSMC',
    'Huawei', 'Baidu', 'JD', 'Xiaomi', 'BYD', 'CATL', 'Coinbase', 'Stripe',
  ],
  // 产品/模型
  products: [
    'GPT', 'GPT-5', 'ChatGPT', 'Claude', 'Gemini', 'Llama', 'Copilot',
    'iPhone', 'iPad', 'Vision Pro', 'Android', 'Windows', 'macOS',
    'Bitcoin', 'Ethereum', 'Solana',
  ],
  // 人物
  people: [
    'Elon Musk', 'Sam Altman', 'Satya Nadella', 'Tim Cook', 'Sundar Pichai',
    'Mark Zuckerberg', 'Jensen Huang', 'Dario Amodei',
    'Trump', 'Biden', 'Xi Jinping', 'Putin',
  ],
  // 组织/国际
  orgs: [
    'EU', 'FDA', 'SEC', 'FTC', 'WHO', 'NATO', 'UN', 'OPEC', 'IMF',
    'Fed', 'ECB', 'PBOC',
  ],
  // 地缘
  geo: [
    'China', 'US', 'Japan', 'India', 'Russia', 'Ukraine', 'Taiwan',
    'Israel', 'Palestine', 'Gaza', 'Iran', 'North Korea',
  ],
};

// LLM Entity 提取 prompt
const ENTITY_EXTRACT_PROMPT = `从以下新闻标题和摘要中提取关键实体（人名、公司、产品、地名、事件名）。

标题: {title}
摘要: {content}

请返回 JSON 数组，每个元素是一个实体字符串。只提取最重要的 3-5 个实体。
例如: ["OpenAI", "GPT-5", "Sam Altman"]

只返回 JSON 数组，不要其他文字。`;
```

---

## 4. Arc 生命周期管理

### 4.1 状态机

```
                    ┌─── 48h 无新 item ───┐
                    │                      ▼
  [创建] ──→ active ──────────────→ stale ──────→ archived
              ▲  │                   │  ▲           │
              │  │                   │  │           │
              │  └── 新 item 加入 ──┘  └── 7d ────┘
              │                         无更新
              └── 新 item 加入（reactivate）
              
  特殊转换：
  - 任何状态 + mergedIntoId → archived（被合并）
  - 用户手动归档 → archived
  - 用户手动重新激活 → active
```

### 4.2 状态转换规则

```typescript
interface LifecycleConfig {
  staleAfterHours: number;      // active → stale: 默认 48h
  archiveAfterHours: number;    // stale → archived: 默认 168h (7天)
  reactivateOnNewItem: boolean; // 新 item 加入是否重新激活: 默认 true
}

const DEFAULT_LIFECYCLE: LifecycleConfig = {
  staleAfterHours: 48,
  archiveAfterHours: 168,
  reactivateOnNewItem: true,
};

/**
 * 生命周期管理 job：每小时运行一次
 */
async function lifecycleTick(): Promise<{ staled: number; archived: number; merged: number }> {
  const now = new Date();
  
  // 1. active → stale（48h 无新 item）
  const staleCutoff = new Date(now.getTime() - DEFAULT_LIFECYCLE.staleAfterHours * 60 * 60 * 1000);
  const staled = await db.update(storyArcs)
    .set({ status: 'stale', updatedAt: now })
    .where(and(
      eq(storyArcs.status, 'active'),
      lt(storyArcs.lastItemAt, staleCutoff),
    ));
  
  // 2. stale → archived（7d 无更新）
  const archiveCutoff = new Date(now.getTime() - DEFAULT_LIFECYCLE.archiveAfterHours * 60 * 60 * 1000);
  const archived = await db.update(storyArcs)
    .set({ status: 'archived', updatedAt: now })
    .where(and(
      eq(storyArcs.status, 'stale'),
      lt(storyArcs.lastItemAt, archiveCutoff),
    ));
  
  // 3. 合并检测
  const users = await db.selectDistinct({ userId: storyArcs.userId })
    .from(storyArcs)
    .where(eq(storyArcs.status, 'active'));
  
  let totalMerged = 0;
  for (const { userId } of users) {
    totalMerged += await checkAndMergeArcs(userId);
  }
  
  return { 
    staled: staled.changes, 
    archived: archived.changes, 
    merged: totalMerged 
  };
}
```

### 4.3 定期清理策略

```typescript
/**
 * 清理 job：每天运行一次（凌晨 3:00）
 * 
 * 清理对象：
 * 1. 30天前的 archived Arc：删除 arc_items 关联，保留 Arc 本身（含摘要）
 * 2. 90天前的 archived Arc：彻底删除
 * 3. 候选池中 48h+ 的 pending items
 */
async function cleanupTick(): Promise<void> {
  const now = new Date();
  
  // 1. 30天前 archived Arc：清除 arc_items 以释放空间
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  await db.delete(arcItems)
    .where(inArray(
      arcItems.arcId,
      db.select({ id: storyArcs.id })
        .from(storyArcs)
        .where(and(
          eq(storyArcs.status, 'archived'),
          lt(storyArcs.updatedAt, thirtyDaysAgo),
        ))
    ));
  
  // 2. 90天前 archived Arc：彻底删除
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  await db.delete(storyArcs)
    .where(and(
      eq(storyArcs.status, 'archived'),
      lt(storyArcs.updatedAt, ninetyDaysAgo),
    ));
}
```

---

## 5. LLM 集成

### 5.1 调用策略

所有 LLM 调用通过现有的 `LLMClient` 进行，使用 frugalai 代理。关键约束：

- **无 tool_use**：不能使用 function calling / tool use
- **文本解析 fallback**：必须能解析纯文本 JSON 回复
- **经济调用**：批量处理，避免 per-item 调用

### 5.2 调用场景与频率

| 场景 | 触发条件 | 频率 | 可降级 |
|------|---------|------|--------|
| Entity 增强提取 | 新 item 入库 | 每 10 条批量 1 次 | ✅ 回退到规则提取 |
| Arc 标题生成 | 新 Arc 创建 | 每个 Arc 1 次 | ✅ 用规则标题 |
| Arc 摘要更新 | Arc 有新 item 加入 | 每 Arc 最多每 2h 1 次 | ✅ 无摘要也可运行 |
| Arc 合并确认 | 合并检测命中 | 每次合并 1 次 | ✅ 自动合并 |

### 5.3 LLM Prompt 设计

#### 5.3.1 Arc 标题生成

```typescript
const ARC_TITLE_PROMPT = `你是一位新闻编辑。以下是一组相关新闻的标题：

{titles}

共享的实体：{entities}

请为这组新闻生成一个"故事线标题"，要求：
1. 简洁有力，10-20个中文字
2. 概括整个事件的主题（不是具体的某条新闻）
3. 用中文

只返回标题文字，不要任何其他内容。

示例：
- "中东冲突与停火谈判"
- "OpenAI GPT-5 发布与行业反应"
- "特斯拉 Q4 财报季"`;
```

#### 5.3.2 Arc 摘要生成

```typescript
const ARC_SUMMARY_PROMPT = `你是一位新闻编辑。以下是一个新闻故事线的时间线：

故事线标题：{arcTitle}
涉及实体：{entities}

时间线（从旧到新）：
{timeline}

请生成一段故事线摘要，要求：
1. 100-200字中文
2. 按时间顺序梳理事件发展
3. 突出关键转折点
4. 最后一句总结当前状态

只返回摘要文字，不要标题或标记。`;
```

#### 5.3.3 批量 Entity 提取

```typescript
const BATCH_ENTITY_PROMPT = `从以下新闻中提取关键实体。每条新闻提取 3-5 个最重要的实体。

{items}

请返回 JSON 数组，格式如下：
[
  {"id": 1, "entities": ["OpenAI", "GPT-5", "Sam Altman"]},
  {"id": 2, "entities": ["Tesla", "Elon Musk", "Q4"]}
]

只返回 JSON，不要其他文字。`;
```

### 5.4 LLM 调用队列

避免 LLM 调用阻塞采集流程：

```typescript
/**
 * LLM 任务队列：异步执行 LLM 增强任务
 * 采集 pipeline 只入队，不等待结果
 */
class ArcLLMQueue {
  private queue: ArcLLMTask[] = [];
  private processing = false;
  private readonly BATCH_SIZE = 5;
  private readonly INTERVAL_MS = 30_000;  // 每 30 秒处理一批
  
  enqueue(task: ArcLLMTask): void {
    this.queue.push(task);
    if (!this.processing) {
      this.startProcessing();
    }
  }
  
  private async startProcessing(): Promise<void> {
    this.processing = true;
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.BATCH_SIZE);
      
      // 按类型分组处理
      const entityTasks = batch.filter(t => t.type === 'entity_extract');
      const titleTasks = batch.filter(t => t.type === 'title_generate');
      const summaryTasks = batch.filter(t => t.type === 'summary_update');
      
      await Promise.allSettled([
        this.processEntityBatch(entityTasks),
        this.processTitleBatch(titleTasks),
        this.processSummaryBatch(summaryTasks),
      ]);
      
      if (this.queue.length > 0) {
        await sleep(this.INTERVAL_MS);
      }
    }
    
    this.processing = false;
  }
}

type ArcLLMTask = 
  | { type: 'entity_extract'; itemIds: string[] }
  | { type: 'title_generate'; arcId: string; itemTitles: string[]; entities: string[] }
  | { type: 'summary_update'; arcId: string }
;
```

### 5.5 降级策略

当 LLM 不可用时（`provider: 'none'` 或 API 失败）：

| 功能 | LLM 可用 | LLM 不可用 |
|------|---------|-----------|
| Entity 提取 | LLM 增强（更精确） | 规则匹配（KNOWN_ENTITIES 列表） |
| Arc 标题 | LLM 生成自然标题 | 共享实体拼接（"OpenAI / GPT-5"） |
| Arc 摘要 | LLM 生成故事梗概 | 无摘要，展示最新 3 条标题 |
| Arc 合并确认 | LLM 判断是否真的同一事件 | 自动合并（entity Jaccard > 0.6） |

---

## 6. Buzz Signal（跨源热度检测）

### 6.1 设计理念

Buzz 是 "同一事件短时间内在多个源出现" 的信号。它与 Story Arc 互补：

- **Arc**：长线追踪（跨天/跨周）
- **Buzz**：短时爆发（6h 内）

Buzz 可以触发 Arc 创建（当 buzz 事件还没有对应的 Arc 时）。

### 6.2 Buzz 检测算法

```typescript
/**
 * Buzz 检测：在采集 pipeline 中与 Arc 匹配同步运行
 * 
 * 输入：新入库的 items
 * 输出：Buzz 事件（如果检测到）
 */
interface BuzzDetector {
  readonly WINDOW_HOURS: number;        // 滑动窗口大小，默认 6h
  readonly MIN_SOURCES: number;         // 最少源数，默认 3
  readonly MIN_ITEMS: number;           // 最少 item 数，默认 3
  
  /**
   * 检测新 item 是否触发 buzz
   */
  detect(newItems: NormalizedItem[]): Promise<BuzzEvent[]>;
}

interface BuzzEvent {
  entityCluster: string[];      // 触发 buzz 的实体组合
  items: string[];              // 涉及的 item IDs
  sources: string[];            // 涉及的 source IDs
  score: number;                // buzz 强度
  existingArcId?: string;       // 如果已有对应 Arc
}

/**
 * Buzz 分数计算：
 * score = sourceCount × log2(itemCount + 1) × velocityBoost
 * 
 * 其中 velocityBoost = itemCount / windowHours（越集中越高）
 */
function computeBuzzScore(event: {
  sourceCount: number;
  itemCount: number;
  windowHours: number;
}): number {
  const velocity = event.itemCount / Math.max(event.windowHours, 0.5);
  return event.sourceCount * Math.log2(event.itemCount + 1) * (1 + velocity);
}
```

### 6.3 Buzz 检测实现

```typescript
class BuzzDetectorImpl implements BuzzDetector {
  readonly WINDOW_HOURS = 6;
  readonly MIN_SOURCES = 3;
  readonly MIN_ITEMS = 3;
  
  async detect(newItems: NormalizedItem[]): Promise<BuzzEvent[]> {
    const windowStart = new Date(Date.now() - this.WINDOW_HOURS * 60 * 60 * 1000);
    
    // 查询窗口内所有 items 的 entities
    const recentItems = await db.select({
      id: feedItems.id,
      sourceId: feedItems.sourceId,
      entities: feedItems.entities,
      publishedAt: feedItems.publishedAt,
    })
    .from(feedItems)
    .where(gte(feedItems.fetchedAt, windowStart));
    
    // 构建 entity → items 倒排索引
    const entityIndex = new Map<string, { itemId: string; sourceId: string }[]>();
    
    for (const item of [...recentItems, ...newItems.map(i => ({
      id: i.id, sourceId: i.sourceId, entities: i.entities,
    }))]) {
      for (const entity of (item.entities as string[] || [])) {
        const key = entity.toLowerCase();
        if (!entityIndex.has(key)) entityIndex.set(key, []);
        entityIndex.get(key)!.push({ itemId: item.id, sourceId: item.sourceId });
      }
    }
    
    // 检测 buzz：哪些 entity 在 3+ 源中出现
    const buzzEvents: BuzzEvent[] = [];
    
    for (const [entity, occurrences] of entityIndex) {
      const uniqueSources = new Set(occurrences.map(o => o.sourceId));
      
      if (uniqueSources.size >= this.MIN_SOURCES && occurrences.length >= this.MIN_ITEMS) {
        const score = computeBuzzScore({
          sourceCount: uniqueSources.size,
          itemCount: occurrences.length,
          windowHours: this.WINDOW_HOURS,
        });
        
        buzzEvents.push({
          entityCluster: [entity],
          items: [...new Set(occurrences.map(o => o.itemId))],
          sources: [...uniqueSources],
          score,
        });
      }
    }
    
    // 合并相似的 buzz events（共享大量 items 的）
    return this.mergeSimilarBuzz(buzzEvents);
  }
  
  private mergeSimilarBuzz(events: BuzzEvent[]): BuzzEvent[] {
    // 按 score 降序，合并 item 重叠度 > 50% 的 events
    events.sort((a, b) => b.score - a.score);
    
    const merged: BuzzEvent[] = [];
    const consumed = new Set<number>();
    
    for (let i = 0; i < events.length; i++) {
      if (consumed.has(i)) continue;
      
      let current = { ...events[i] };
      
      for (let j = i + 1; j < events.length; j++) {
        if (consumed.has(j)) continue;
        
        const overlap = events[j].items.filter(id => current.items.includes(id));
        if (overlap.length / Math.min(current.items.length, events[j].items.length) > 0.5) {
          // 合并
          current.entityCluster = [...new Set([...current.entityCluster, ...events[j].entityCluster])];
          current.items = [...new Set([...current.items, ...events[j].items])];
          current.sources = [...new Set([...current.sources, ...events[j].sources])];
          current.score = Math.max(current.score, events[j].score);
          consumed.add(j);
        }
      }
      
      merged.push(current);
    }
    
    return merged;
  }
}
```

### 6.4 Buzz → Arc 关联

```typescript
/**
 * Buzz 后处理：将 buzz 事件与 Arc 关联
 */
async function processBuzzEvents(events: BuzzEvent[], userId: string): Promise<void> {
  for (const event of events) {
    // 1. 检查是否已有对应 Arc
    const matchingArc = await findArcByEntities(userId, event.entityCluster);
    
    if (matchingArc) {
      // 更新 Arc 的 buzzScore
      event.existingArcId = matchingArc.id;
      await db.update(storyArcs)
        .set({ buzzScore: event.score, updatedAt: new Date() })
        .where(eq(storyArcs.id, matchingArc.id));
    } else {
      // 没有对应 Arc → 自动创建
      // Buzz 条件本身就满足 Arc 创建条件（多源 + 多 item）
      const newArc = await createArcFromBuzz(event, userId);
      event.existingArcId = newArc.id;
    }
    
    // 2. 存储 buzz event
    await db.insert(buzzEvents).values({
      id: nanoid(),
      arcId: event.existingArcId,
      entityCluster: event.entityCluster,
      sourceIds: event.sources,
      itemIds: event.items,
      score: event.score,
      windowStart: new Date(Date.now() - 6 * 60 * 60 * 1000),
      windowEnd: new Date(),
      createdAt: new Date(),
    });
    
    // 3. 检查是否需要发送 alert
    await checkBuzzAlert(event, userId);
  }
}
```

### 6.5 Alert 推送条件

```typescript
/**
 * Buzz Alert 推送条件（可在 user_preferences.alerts 中配置）
 * 
 * 默认条件：
 * - buzz score > 10
 * - 或 tier 1 源参与数 >= 2
 * - cooldown: 同一 Arc 24h 内不重复 alert
 * - 遵守 quiet hours
 */
async function checkBuzzAlert(event: BuzzEvent, userId: string): Promise<void> {
  const prefs = await getUserPreferences(userId);
  const alertConfig = prefs?.alerts;
  
  if (!alertConfig?.enabled) return;
  
  const minBuzz = alertConfig.minBuzz ?? 10;
  
  if (event.score < minBuzz) return;
  
  // Cooldown 检查
  const cooldownHours = alertConfig.cooldownHours ?? 24;
  if (event.existingArcId) {
    const recentAlert = await db.select()
      .from(buzzEvents)
      .where(and(
        eq(buzzEvents.arcId, event.existingArcId),
        eq(buzzEvents.alerted, true),
        gte(buzzEvents.createdAt, new Date(Date.now() - cooldownHours * 60 * 60 * 1000)),
      ))
      .limit(1)
      .get();
    
    if (recentAlert) return;  // 冷却中
  }
  
  // 生成并推送 buzz digest
  const digest = await generateDigest(userId, { tier: 'alert' });
  // 推送逻辑复用现有 push 系统
}
```

---

## 7. API 设计

### 7.1 路由概览

```
/api/v1/me/arcs
  GET    /                    Arc 列表（支持筛选、分页）
  GET    /:id                 Arc 详情（含时间线）
  PATCH  /:id                 更新 Arc（手动编辑标题、归档等）
  DELETE /:id                 删除 Arc
  POST   /:id/merge           手动合并两个 Arc
  POST   /:id/items           手动将 item 添加到 Arc

/api/v1/me/buzz
  GET    /                    Buzz 事件列表
  GET    /top                 热门 Buzz 排行
```

### 7.2 端点定义

```typescript
// packages/backend/src/routes/arcs.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/client.js';
import { storyArcs, arcItems, feedItems } from '../db/schema.js';
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';

const arcRoutes = new Hono<{ Variables: AuthVariables }>();

arcRoutes.use('*', requireAuth);

// ─── GET /me/arcs ─── Arc 列表
arcRoutes.get('/', zValidator('query', z.object({
  status: z.enum(['active', 'stale', 'archived', 'all']).default('active'),
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
  sort: z.enum(['lastItemAt', 'buzzScore', 'itemCount', 'createdAt']).default('lastItemAt'),
})), async (c) => {
  const user = c.get('user');
  const { status, limit, offset, sort } = c.req.valid('query');
  
  const conditions = [eq(storyArcs.userId, user.id)];
  if (status !== 'all') {
    conditions.push(eq(storyArcs.status, status));
  }
  
  const sortColumn = {
    lastItemAt: storyArcs.lastItemAt,
    buzzScore: storyArcs.buzzScore,
    itemCount: storyArcs.itemCount,
    createdAt: storyArcs.createdAt,
  }[sort];
  
  const [results, countResult] = await Promise.all([
    db.select()
      .from(storyArcs)
      .where(and(...conditions))
      .orderBy(desc(sortColumn))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(storyArcs)
      .where(and(...conditions)),
  ]);
  
  return c.json({
    arcs: results,
    total: countResult[0]?.count ?? 0,
    limit,
    offset,
  });
});

// ─── GET /me/arcs/:id ─── Arc 详情（含时间线）
arcRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const arcId = c.req.param('id');
  
  const arc = await db.select()
    .from(storyArcs)
    .where(and(eq(storyArcs.id, arcId), eq(storyArcs.userId, user.id)))
    .get();
  
  if (!arc) return c.json({ error: 'Not found' }, 404);
  
  // 查询关联的 items（按时间排序 = 时间线）
  const items = await db.select({
    arcItem: arcItems,
    feedItem: feedItems,
  })
  .from(arcItems)
  .innerJoin(feedItems, eq(arcItems.itemId, feedItems.id))
  .where(eq(arcItems.arcId, arcId))
  .orderBy(desc(feedItems.publishedAt));
  
  const timeline = items.map(({ arcItem, feedItem }) => ({
    id: feedItem.id,
    title: feedItem.title,
    url: feedItem.url,
    source: feedItem.sourceId,
    publishedAt: feedItem.publishedAt,
    relevanceScore: arcItem.relevanceScore,
    isKeyEvent: arcItem.isKeyEvent,
    headline: arcItem.headline,
    addedAt: arcItem.addedAt,
  }));
  
  return c.json({ arc, timeline });
});

// ─── PATCH /me/arcs/:id ─── 更新 Arc
arcRoutes.patch('/:id', zValidator('json', z.object({
  title: z.string().min(1).max(100).optional(),
  status: z.enum(['active', 'stale', 'archived']).optional(),
  tags: z.array(z.string()).optional(),
}).partial()), async (c) => {
  const user = c.get('user');
  const arcId = c.req.param('id');
  const updates = c.req.valid('json');
  
  const arc = await db.select()
    .from(storyArcs)
    .where(and(eq(storyArcs.id, arcId), eq(storyArcs.userId, user.id)))
    .get();
  
  if (!arc) return c.json({ error: 'Not found' }, 404);
  
  await db.update(storyArcs)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(storyArcs.id, arcId));
  
  return c.json({ ok: true });
});

// ─── DELETE /me/arcs/:id ─── 删除 Arc
arcRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const arcId = c.req.param('id');
  
  const arc = await db.select()
    .from(storyArcs)
    .where(and(eq(storyArcs.id, arcId), eq(storyArcs.userId, user.id)))
    .get();
  
  if (!arc) return c.json({ error: 'Not found' }, 404);
  
  // Cascade: arc_items 已设置 onDelete: 'cascade'
  await db.delete(storyArcs).where(eq(storyArcs.id, arcId));
  
  return c.json({ ok: true });
});

// ─── POST /me/arcs/:id/merge ─── 手动合并
arcRoutes.post('/:id/merge', zValidator('json', z.object({
  targetArcId: z.string(),
})), async (c) => {
  const user = c.get('user');
  const sourceArcId = c.req.param('id');
  const { targetArcId } = c.req.valid('json');
  
  // 验证两个 Arc 都属于当前用户
  const [sourceArc, targetArc] = await Promise.all([
    db.select().from(storyArcs)
      .where(and(eq(storyArcs.id, sourceArcId), eq(storyArcs.userId, user.id))).get(),
    db.select().from(storyArcs)
      .where(and(eq(storyArcs.id, targetArcId), eq(storyArcs.userId, user.id))).get(),
  ]);
  
  if (!sourceArc || !targetArc) return c.json({ error: 'Arc not found' }, 404);
  
  await mergeArc(sourceArcId, targetArcId);
  
  return c.json({ ok: true, mergedInto: targetArcId });
});

// ─── POST /me/arcs/:id/items ─── 手动添加 item
arcRoutes.post('/:id/items', zValidator('json', z.object({
  itemId: z.string(),
})), async (c) => {
  const user = c.get('user');
  const arcId = c.req.param('id');
  const { itemId } = c.req.valid('json');
  
  // 验证 Arc 和 item 存在
  const arc = await db.select().from(storyArcs)
    .where(and(eq(storyArcs.id, arcId), eq(storyArcs.userId, user.id))).get();
  const item = await db.select().from(feedItems)
    .where(eq(feedItems.id, itemId)).get();
  
  if (!arc || !item) return c.json({ error: 'Not found' }, 404);
  
  await addItemToArc(arcId, itemId, { manual: true });
  
  return c.json({ ok: true });
});

export { arcRoutes };
```

### 7.3 Buzz 路由

```typescript
// packages/backend/src/routes/buzz.ts

const buzzRoutes = new Hono<{ Variables: AuthVariables }>();
buzzRoutes.use('*', requireAuth);

// GET /me/buzz — 最近 Buzz 事件
buzzRoutes.get('/', zValidator('query', z.object({
  limit: z.coerce.number().min(1).max(50).default(10),
  hours: z.coerce.number().min(1).max(168).default(24),
})), async (c) => {
  const { limit, hours } = c.req.valid('query');
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const events = await db.select()
    .from(buzzEvents)
    .where(gte(buzzEvents.createdAt, since))
    .orderBy(desc(buzzEvents.score))
    .limit(limit);
  
  return c.json({ events });
});

// GET /me/buzz/top — 热门排行（含关联 Arc 信息）
buzzRoutes.get('/top', async (c) => {
  const events = await db.select({
    buzz: buzzEvents,
    arc: storyArcs,
  })
  .from(buzzEvents)
  .leftJoin(storyArcs, eq(buzzEvents.arcId, storyArcs.id))
  .where(gte(buzzEvents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))
  .orderBy(desc(buzzEvents.score))
  .limit(10);
  
  return c.json({
    top: events.map(({ buzz, arc }) => ({
      ...buzz,
      arc: arc ? { id: arc.id, title: arc.title, status: arc.status } : null,
    })),
  });
});

export { buzzRoutes };
```

### 7.4 路由注册

```typescript
// packages/backend/src/index.ts — 新增路由
import { arcRoutes } from './routes/arcs.js';
import { buzzRoutes } from './routes/buzz.js';

// ... existing routes ...
app.route('/api/v1/me/arcs', arcRoutes);
app.route('/api/v1/me/buzz', buzzRoutes);
```

---

## 8. Digest 集成

### 8.1 Digest 中引用 Arc

在 Daily Digest 渲染时，为每条新闻标注所属的 Story Arc：

```typescript
// packages/backend/src/engine/digest/renderer.ts — 增强

/**
 * 在渲染每条 item 时，查询其所属 Arc 并添加标注
 */
function renderItemWithArc(item: EnhancedItem, arcInfo?: { id: string; title: string }): string {
  let md = renderItemBasic(item);
  
  if (arcInfo) {
    md += `\n> 📖 故事线：[${arcInfo.title}](/arcs/${arcInfo.id})\n`;
  }
  
  return md;
}
```

### 8.2 Buzz 热点板块

在 Daily Digest 末尾添加 Buzz 板块：

```typescript
/**
 * Digest 新板块：🔥 热点事件
 * 展示当天 buzz score 最高的 3 个事件
 */
function renderBuzzSection(buzzEvents: BuzzEvent[]): string {
  if (buzzEvents.length === 0) return '';
  
  let md = '\n---\n\n## 🔥 今日热点\n\n';
  
  for (const event of buzzEvents.slice(0, 3)) {
    const entities = event.entityCluster.join(', ');
    const sourceCount = event.sources.length;
    md += `- **${entities}** — ${sourceCount} 个源报道，`;
    md += `热度 ${event.score.toFixed(1)}\n`;
  }
  
  return md;
}
```

### 8.3 Serendipity Slot

从非用户 topic 的高 buzz 事件中随机选 1 条，添加到 Digest：

```typescript
/**
 * Serendipity：从用户不常看的领域选 1 条高 buzz 新闻
 * 
 * 选择策略：
 * 1. 查找当天 buzz > 5 的事件
 * 2. 过滤掉用户 topic 匹配的
 * 3. 从剩余中随机选 1 条
 */
async function pickSerendipityItem(
  userId: string,
  topics: { keywords: string[] }[],
): Promise<EnhancedItem | null> {
  const prefs = await getUserPreferences(userId);
  if (!prefs?.serendipity?.enabled) return null;
  
  const allKeywords = topics.flatMap(t => t.keywords.map(k => k.toLowerCase()));
  
  // 查找最近 24h 的 buzz 事件
  const recentBuzz = await db.select()
    .from(buzzEvents)
    .where(and(
      gte(buzzEvents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      gte(buzzEvents.score, prefs.serendipity.minBuzz ?? 5),
    ))
    .orderBy(desc(buzzEvents.score));
  
  // 过滤掉用户常看的话题
  const nonTopicBuzz = recentBuzz.filter(event => {
    const entities = event.entityCluster as string[];
    return !entities.some(e => allKeywords.includes(e.toLowerCase()));
  });
  
  if (nonTopicBuzz.length === 0) return null;
  
  // 随机选一条
  const picked = nonTopicBuzz[Math.floor(Math.random() * nonTopicBuzz.length)];
  
  // 获取该 buzz 事件中评分最高的 item
  const itemIds = picked.itemIds as string[];
  if (itemIds.length === 0) return null;
  
  const item = await db.select()
    .from(feedItems)
    .where(inArray(feedItems.id, itemIds))
    .orderBy(desc(feedItems.publishedAt))
    .limit(1)
    .get();
  
  return item as EnhancedItem | null;
}
```

### 8.4 Digest Pipeline 修改

```typescript
// packages/backend/src/engine/digest/pipeline.ts — 修改点

export async function generateDigest(userId: string, options: GenerateOptions): Promise<GenerateResult> {
  // ... 现有逻辑 ...
  
  // ★ 新增步骤 5.5: 查询 Arc 关联
  const itemArcMap = await getItemArcMap(topItems.map(i => i.id), userId);
  
  // ★ 新增步骤 5.6: 查询 Buzz 事件
  const buzzData = tier !== 'flash' 
    ? await getRecentBuzzEvents(24) 
    : [];
  
  // ★ 新增步骤 5.7: Serendipity
  const serendipityItem = tier === 'daily' 
    ? await pickSerendipityItem(userId, topics) 
    : null;
  
  // 6. Render（传入 Arc 和 Buzz 数据）
  const { markdown, html } = renderDigest(enhancedItems, tier, date, {
    itemArcMap,
    buzzEvents: buzzData,
    serendipityItem,
  });
  
  // 7. Store（记录关联的 arcIds）
  const arcIds = [...new Set(Object.values(itemArcMap).map(a => a.id))];
  
  await db.insert(digests).values({
    // ... existing fields ...
    arcIds,  // 已有字段，直接使用
  });
}
```

---

## 9. 前端页面方案

### 9.1 新增页面

| 页面 | 路径 | 说明 |
|------|------|------|
| Arc 列表 | `/arcs` | 活跃故事线一览 |
| Arc 详情 | `/arcs/:id` | 时间线视图 + 关联新闻 |
| Buzz 排行 | `/buzz` | 热点事件排行（可嵌入 Dashboard） |

### 9.2 Arc 列表页

```
┌─────────────────────────────────────────────┐
│  📖 故事线追踪                    筛选: [All ▾] │
├─────────────────────────────────────────────┤
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │ 🟢 中东冲突与停火谈判                    │ │
│  │ 12 条新闻 · 来自 5 个源 · 最后更新 2h 前  │ │
│  │ 🔥 热度 8.5                             │ │
│  │                                        │ │
│  │ 最新动态：以色列和哈马斯在卡塔尔恢复谈判... │ │
│  │ 实体: Israel, Hamas, Qatar, UN          │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │ 🟢 OpenAI GPT-5 发布与行业反应          │ │
│  │ 8 条新闻 · 来自 4 个源 · 最后更新 5h 前   │ │
│  │                                        │ │
│  │ 最新动态：开发者社区对 GPT-5 评测初步结果..│ │
│  │ 实体: OpenAI, GPT-5, Sam Altman        │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │ 🟡 特斯拉 Q4 财报季                     │ │
│  │ 5 条新闻 · 来自 3 个源 · 最后更新 3 天前  │ │
│  │ (stale)                                │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  加载更多...                                 │
└─────────────────────────────────────────────┘
```

**组件结构：**

```typescript
// packages/frontend/src/pages/Arcs.tsx
interface ArcListProps {}

function Arcs() {
  const [status, setStatus] = useState<'active' | 'stale' | 'all'>('active');
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  
  return (
    <div>
      <PageHeader title="📖 故事线追踪" />
      <StatusFilter value={status} onChange={setStatus} />
      <ArcCardList arcs={arcs} />
      <Pagination />
    </div>
  );
}

// packages/frontend/src/components/arc/ArcCard.tsx
function ArcCard({ arc }: { arc: StoryArc }) {
  const statusColor = { active: 'green', stale: 'yellow', archived: 'gray' };
  
  return (
    <Card>
      <CardHeader>
        <StatusDot color={statusColor[arc.status]} />
        <CardTitle>{arc.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 text-sm text-muted-foreground">
          <span>{arc.itemCount} 条新闻</span>
          <span>·</span>
          <span>来自 {arc.sourceCount} 个源</span>
          <span>·</span>
          <span>最后更新 {formatRelative(arc.lastItemAt)}</span>
        </div>
        {arc.buzzScore > 0 && <Badge variant="destructive">🔥 热度 {arc.buzzScore.toFixed(1)}</Badge>}
        {arc.summary && <p className="mt-2 text-sm">{arc.summary}</p>}
        <EntityTags entities={arc.entities} />
      </CardContent>
    </Card>
  );
}
```

### 9.3 Arc 详情页（时间线视图）

```
┌─────────────────────────────────────────────┐
│  ← 返回                                     │
│                                             │
│  📖 中东冲突与停火谈判                        │
│  🟢 active · 12 条新闻 · 5 个源              │
│                                             │
│  ┌─ 摘要 ─────────────────────────────────┐ │
│  │ 自 2 月中旬以来，以色列与哈马斯的冲突持  │ │
│  │ 续升级。3月3日双方在卡塔尔首都多哈重启   │ │
│  │ 谈判，国际社会密切关注。目前谈判仍在进行 │ │
│  │ 中，停火协议尚未达成。                   │ │
│  └─────────────────────────────────────────┘ │
│                                             │
│  ── 时间线 ──────────────────────────────── │
│                                             │
│  ● 3/7 15:30                               │
│  │ 联合国安理会紧急会议讨论停火决议          │
│  │ 📰 Reuters · ⭐ 关键节点                 │
│  │                                         │
│  ● 3/6 10:00                               │
│  │ 以色列宣布暂时开放人道主义通道            │
│  │ 📰 BBC News                             │
│  │                                         │
│  ● 3/5 22:15                               │
│  │ 哈马斯回应停火条件                       │
│  │ 📰 Al Jazeera                           │
│  │                                         │
│  ● 3/3 14:00                               │
│  │ 卡塔尔主持新一轮谈判                     │
│  │ 📰 Bloomberg · ⭐ 关键节点               │
│  │                                         │
│  ● 3/1 08:30                               │
│  │ 国际社会呼吁立即停火                     │
│  │ 📰 NYT                                  │
│  │                                         │
│  ...                                        │
│                                             │
│  [归档] [编辑标题] [手动添加新闻]             │
└─────────────────────────────────────────────┘
```

**组件结构：**

```typescript
// packages/frontend/src/pages/ArcDetail.tsx
function ArcDetail() {
  const { id } = useParams();
  const [arc, setArc] = useState<StoryArc | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  
  return (
    <div>
      <BackButton />
      <ArcHeader arc={arc} />
      {arc?.summary && <ArcSummary text={arc.summary} />}
      <Timeline items={timeline} />
      <ArcActions arcId={id} />
    </div>
  );
}

// packages/frontend/src/components/arc/Timeline.tsx
function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="relative pl-8">
      <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
      {items.map((item) => (
        <TimelineNode key={item.id} item={item} />
      ))}
    </div>
  );
}

function TimelineNode({ item }: { item: TimelineItem }) {
  return (
    <div className="relative pb-6">
      <div className="absolute left-[-1.25rem] w-3 h-3 rounded-full bg-primary" />
      <div className="text-xs text-muted-foreground">
        {formatDate(item.publishedAt)}
      </div>
      <a href={item.url} target="_blank" className="font-medium hover:underline">
        {item.headline || item.title}
      </a>
      <div className="flex items-center gap-2 text-xs mt-1">
        <span>📰 {item.sourceName}</span>
        {item.isKeyEvent && <Badge variant="outline">⭐ 关键节点</Badge>}
      </div>
    </div>
  );
}
```

### 9.4 Dashboard 集成

在现有 Dashboard 页面添加 Story Arc 概览卡片：

```typescript
// packages/frontend/src/pages/Dashboard.tsx — 新增模块

function DashboardArcSummary() {
  const [stats, setStats] = useState({ active: 0, stale: 0, topBuzz: null });
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>📖 故事线追踪</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="活跃故事线" value={stats.active} />
          <Stat label="待关注" value={stats.stale} />
        </div>
        {stats.topBuzz && (
          <div className="mt-4 p-3 bg-destructive/10 rounded-lg">
            <p className="text-sm font-medium">🔥 今日热点</p>
            <p className="text-sm">{stats.topBuzz.title}</p>
          </div>
        )}
        <Link to="/arcs" className="text-sm text-primary mt-2 block">
          查看全部 →
        </Link>
      </CardContent>
    </Card>
  );
}
```

---

## 10. 采集 Pipeline 集成

### 10.1 修改后的采集流程

```
┌──────────────────────────────────────────────────────────────┐
│                     FeedScheduler.tick()                      │
│                                                              │
│  sources → fetchBatch → normalize → dedup → storeItems       │
│                                                    │         │
│                                              ★ arcMatch      │
│                                              (同步, 快速)     │
│                                                    │         │
│                                          ┌────────┴────────┐ │
│                                          │                 │ │
│                                     匹配成功           无匹配  │
│                                     addToArc       addToPool │
│                                          │                 │ │
│                                          └────────┬────────┘ │
│                                                   │         │
│                                            ★ buzzDetect     │
│                                            (同步, 快速)      │
│                                                   │         │
│                                          ┌────────┴────────┐ │
│                                          │                 │ │
│                                     buzz 检测到       无 buzz │
│                                     processBuzz       done   │
│                                          │                  │
│                                          └──────────────────┘ │
│                                                              │
│  ★ arcEnhanceQueue (异步, 延迟)                               │
│  - Entity 增强提取                                           │
│  - Arc 标题生成                                              │
│  - Arc 摘要更新                                              │
└──────────────────────────────────────────────────────────────┘
```

### 10.2 代码集成点

```typescript
// packages/backend/src/engine/scheduler.ts — 修改

import { ArcEngine } from './arc/engine.js';

export class FeedScheduler {
  private fetchManager: FetchManager;
  private arcEngine: ArcEngine;  // ★ 新增
  
  constructor() {
    this.fetchManager = new FetchManager();
    this.arcEngine = new ArcEngine();  // ★ 新增
  }
  
  async tick(): Promise<{ fetched: number; inserted: number }> {
    // ... 现有 fetch + normalize + dedup + store 逻辑 ...
    
    for (const result of results) {
      // ... existing logic ...
      
      const normalized = normalize(result.items, result.source, fetchedAt);
      const deduped = dedup(normalized);
      const { inserted } = await storeItems(deduped);
      totalInserted += inserted;
      
      // ★ 新增：Arc 匹配 + Buzz 检测
      if (inserted > 0) {
        await this.arcEngine.processNewItems(deduped);
      }
    }
    
    return { fetched: dueSources.length, inserted: totalInserted };
  }
}
```

### 10.3 ArcEngine 核心类

```typescript
// packages/backend/src/engine/arc/engine.ts

import { ArcSnapshotCache } from './snapshot-cache.js';
import { ArcCandidatePool } from './candidate-pool.js';
import { BuzzDetectorImpl } from './buzz-detector.js';
import { ArcLLMQueue } from './llm-queue.js';
import { db } from '../../db/client.js';
import { storyArcs, arcItems, feedItems } from '../../db/schema.js';
import { nanoid } from 'nanoid';
import { logger } from '../../shared/logger.js';

export class ArcEngine {
  private snapshotCache: ArcSnapshotCache;
  private candidatePool: ArcCandidatePool;
  private buzzDetector: BuzzDetectorImpl;
  private llmQueue: ArcLLMQueue;
  
  constructor() {
    this.snapshotCache = new ArcSnapshotCache();
    this.candidatePool = new ArcCandidatePool();
    this.buzzDetector = new BuzzDetectorImpl();
    this.llmQueue = new ArcLLMQueue();
  }
  
  /**
   * 主入口：处理新入库的 items
   * 在采集 pipeline 中同步调用，必须快速
   */
  async processNewItems(items: NormalizedItem[]): Promise<void> {
    const startTime = Date.now();
    
    // TODO: 当前简化为处理所有用户
    // 未来应按用户分组处理
    const userIds = await this.getActiveUserIds();
    
    for (const userId of userIds) {
      const activeArcs = await this.snapshotCache.getActiveArcs(userId);
      
      for (const item of items) {
        // 1. 尝试匹配已有 Arc
        const match = matchItemToArc(item, activeArcs, DEFAULT_MATCH_CONFIG);
        
        if (match.arcId) {
          // 匹配成功 → 添加到 Arc
          await this.addItemToArc(match.arcId, item, match.score, userId);
        } else {
          // 无匹配 → 进入候选池
          const candidate = this.candidatePool.addAndCheck({
            itemId: item.id,
            userId,
            title: item.title,
            entities: item.entities,
            sourceId: item.sourceId,
            publishedAt: item.publishedAt ?? new Date(),
            addedAt: new Date(),
          });
          
          if (candidate) {
            // 候选池聚集够了 → 创建新 Arc
            await this.createArc(candidate, userId);
          }
        }
      }
      
      // 2. Buzz 检测
      const buzzEvents = await this.buzzDetector.detect(items);
      if (buzzEvents.length > 0) {
        await processBuzzEvents(buzzEvents, userId);
      }
    }
    
    const durationMs = Date.now() - startTime;
    logger.info({ items: items.length, durationMs }, 'Arc engine processed items');
  }
  
  private async addItemToArc(
    arcId: string, 
    item: NormalizedItem, 
    relevanceScore: number,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    
    // 插入 arc_items
    await db.insert(arcItems).values({
      id: nanoid(),
      arcId,
      itemId: item.id,
      relevanceScore,
      addedAt: now,
    }).onConflictDoNothing();  // 避免重复
    
    // 更新 Arc 元数据
    const arc = await db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).get();
    if (!arc) return;
    
    const newEntities = [...new Set([...(arc.entities as string[]), ...item.entities])];
    const newSourceCount = await this.countDistinctSources(arcId);
    
    await db.update(storyArcs).set({
      lastItemAt: now,
      itemCount: sql`${storyArcs.itemCount} + 1`,
      sourceCount: newSourceCount,
      entities: newEntities,
      status: 'active',  // 重新激活
      updatedAt: now,
    }).where(eq(storyArcs.id, arcId));
    
    // 更新缓存
    this.snapshotCache.updateArc(userId, {
      id: arcId,
      userId,
      entities: newEntities,
      keywords: arc.keywords as string[] ?? [],
      recentTitles: [item.title, ...(await this.getRecentTitles(arcId, 4))],
      lastItemAt: now,
      sourceIds: new Set(), // 将在下次 refresh 更新
      itemCount: (arc.itemCount ?? 0) + 1,
    });
    
    // 异步：LLM 摘要更新
    if (this.shouldUpdateSummary(arc)) {
      this.llmQueue.enqueue({ type: 'summary_update', arcId });
    }
  }
  
  private async createArc(candidate: ArcCreationCandidate, userId: string): Promise<string> {
    const now = new Date();
    const arcId = nanoid();
    
    // 创建 Arc
    await db.insert(storyArcs).values({
      id: arcId,
      userId,
      title: candidate.suggestedTitle,
      entities: candidate.sharedEntities,
      keywords: candidate.sharedEntities,  // 初始 keywords = entities
      status: 'active',
      firstSeenAt: now,
      lastItemAt: now,
      itemCount: candidate.items.length,
      sourceCount: new Set(candidate.items.map(i => i.sourceId)).size,
      titleSource: 'rule',
      createdAt: now,
      updatedAt: now,
    });
    
    // 关联 items
    for (const item of candidate.items) {
      await db.insert(arcItems).values({
        id: nanoid(),
        arcId,
        itemId: item.itemId,
        relevanceScore: 1.0,
        addedAt: now,
      });
    }
    
    logger.info({ arcId, title: candidate.suggestedTitle, items: candidate.items.length }, 'New Arc created');
    
    // 异步：LLM 生成更好的标题
    this.llmQueue.enqueue({
      type: 'title_generate',
      arcId,
      itemTitles: candidate.items.map(i => i.title),
      entities: candidate.sharedEntities,
    });
    
    return arcId;
  }
  
  private shouldUpdateSummary(arc: typeof storyArcs.$inferSelect): boolean {
    // 至少间隔 2h 才更新摘要
    if (!arc.summaryUpdatedAt) return true;
    const hoursSince = (Date.now() - new Date(arc.summaryUpdatedAt).getTime()) / (1000 * 60 * 60);
    return hoursSince >= 2;
  }
  
  private async countDistinctSources(arcId: string): Promise<number> {
    const result = await db.select({ 
      count: sql<number>`count(distinct ${feedItems.sourceId})` 
    })
    .from(arcItems)
    .innerJoin(feedItems, eq(arcItems.itemId, feedItems.id))
    .where(eq(arcItems.arcId, arcId));
    
    return result[0]?.count ?? 0;
  }
  
  private async getRecentTitles(arcId: string, limit: number): Promise<string[]> {
    const items = await db.select({ title: feedItems.title })
      .from(arcItems)
      .innerJoin(feedItems, eq(arcItems.itemId, feedItems.id))
      .where(eq(arcItems.arcId, arcId))
      .orderBy(desc(arcItems.addedAt))
      .limit(limit);
    
    return items.map(i => i.title ?? '');
  }
  
  private async getActiveUserIds(): Promise<string[]> {
    const users = await db.selectDistinct({ id: storyArcs.userId })
      .from(storyArcs)
      .where(eq(storyArcs.status, 'active'));
    
    // 如果没有 active Arc 的用户，返回所有用户（首次使用）
    if (users.length === 0) {
      const allUsers = await db.select({ id: users_table.id }).from(users_table);
      return allUsers.map(u => u.id);
    }
    
    return users.map(u => u.id);
  }
}
```

### 10.4 性能预算

| 操作 | 耗时预算 | 说明 |
|------|---------|------|
| Arc 匹配（单 item） | < 5ms | 内存缓存比较，无 DB 查询 |
| Arc 匹配（一批 50 items） | < 250ms | 50 × 5ms |
| 候选池检查 | < 2ms | 内存操作 |
| Buzz 检测 | < 100ms | 1 次 DB 查询 + 内存计算 |
| 总体额外开销 | < 500ms/batch | 不超过现有采集耗时的 10% |

---

## 11. MVP 范围与工时预估

### 11.1 Phase 划分

#### Phase 1: Arc 核心（MVP - 必做）

| 任务 | 预估工时 | 说明 |
|------|---------|------|
| Schema migration（增强现有表） | 2h | Drizzle migration |
| ArcSnapshotCache | 3h | 内存缓存 + DB 加载 |
| matchItemToArc 算法 | 4h | 核心匹配逻辑 |
| ArcCandidatePool | 3h | 候选池 + 新 Arc 创建 |
| ArcEngine 集成到 scheduler | 3h | Pipeline 嵌入 |
| Arc 生命周期管理 cron | 2h | 状态转换 + 清理 |
| Arc API（CRUD + 详情） | 4h | Hono 路由 |
| Arc 列表页前端 | 4h | React 页面 |
| Arc 详情页（时间线） | 4h | Timeline 组件 |
| Dashboard 集成 | 2h | 概览卡片 |
| **小计** | **31h** | **约 4 个工作日** |

#### Phase 2: LLM + Buzz（增强 - 可延后 1-2 周）

| 任务 | 预估工时 | 说明 |
|------|---------|------|
| ArcLLMQueue 异步队列 | 3h | 任务队列 + 批量处理 |
| LLM 标题生成 | 2h | Prompt + 解析 |
| LLM 摘要更新 | 3h | Prompt + 增量更新 |
| LLM Entity 增强提取 | 3h | 批量 prompt + 回写 |
| BuzzDetector | 4h | 检测算法 |
| Buzz → Arc 关联 | 2h | 自动创建 / 关联 |
| buzz_events 表 + API | 3h | Schema + 路由 |
| Buzz Alert 推送 | 2h | 复用 push 系统 |
| Buzz 前端排行页 | 3h | React 页面 |
| **小计** | **25h** | **约 3 个工作日** |

#### Phase 3: Digest 集成 + 打磨（完善 - 可延后 2-4 周）

| 任务 | 预估工时 | 说明 |
|------|---------|------|
| Digest 中引用 Arc | 2h | Renderer 修改 |
| Buzz 热点板块 | 2h | Digest 新板块 |
| Serendipity slot | 3h | 选择算法 + 渲染 |
| Arc 合并策略 | 3h | 自动检测 + 手动合并 |
| 扩展 Entity 列表 | 2h | 200+ 实体 |
| E2E 测试 | 4h | 完整流程测试 |
| 性能优化 | 3h | 索引 + 缓存调优 |
| **小计** | **19h** | **约 2.5 个工作日** |

### 11.2 总工时

| Phase | 工时 | 状态 |
|-------|------|------|
| Phase 1: Arc 核心 | ~31h（4天） | **MVP 必做** |
| Phase 2: LLM + Buzz | ~25h（3天） | 可延后 |
| Phase 3: Digest 集成 | ~19h（2.5天） | 可延后 |
| **总计** | **~75h（~10天）** | |

### 11.3 建议实施顺序

```
Week 1: Phase 1（Arc 核心）
  Day 1: Schema + Cache + Matcher
  Day 2: CandidatePool + Engine + Scheduler 集成
  Day 3: API + Lifecycle cron
  Day 4: 前端（列表 + 详情 + Dashboard）

Week 2: Phase 2（LLM + Buzz）
  Day 5: LLM Queue + Title/Summary
  Day 6: Entity 增强 + BuzzDetector
  Day 7: Buzz API + Alert + 前端

Week 3: Phase 3（Digest 集成 + 打磨）
  Day 8: Digest Arc 引用 + Buzz 板块
  Day 9: Serendipity + Arc 合并
  Day 10: 测试 + 性能优化
```

---

## 附录 A: 文件结构

```
packages/backend/src/engine/arc/
├── engine.ts              # ArcEngine 主类
├── matcher.ts             # 匹配算法
├── candidate-pool.ts      # 候选池
├── snapshot-cache.ts      # 内存快照缓存
├── lifecycle.ts           # 生命周期管理
├── merge.ts               # Arc 合并
├── buzz-detector.ts       # Buzz 检测
├── llm-queue.ts           # LLM 异步任务队列
└── types.ts               # 类型定义

packages/backend/src/routes/
├── arcs.ts                # Arc API 路由
└── buzz.ts                # Buzz API 路由

packages/frontend/src/pages/
├── Arcs.tsx               # Arc 列表页
├── ArcDetail.tsx          # Arc 详情页（时间线）
└── Buzz.tsx               # Buzz 排行页（可选独立页，或嵌入 Dashboard）

packages/frontend/src/components/arc/
├── ArcCard.tsx            # Arc 卡片组件
├── Timeline.tsx           # 时间线组件
├── TimelineNode.tsx       # 时间线节点
├── EntityTags.tsx         # Entity 标签
├── StatusFilter.tsx       # 状态筛选
└── ArcSummary.tsx         # 摘要展示
```

## 附录 B: 关键配置常量

```typescript
// packages/backend/src/engine/arc/types.ts

export const ARC_CONFIG = {
  // 匹配
  MATCH_THRESHOLD: 0.4,
  ENTITY_WEIGHT: 0.5,
  TITLE_WEIGHT: 0.3,
  TIME_DECAY_WEIGHT: 0.2,
  TIME_WINDOW_HOURS: 168,  // 7天
  
  // 创建
  MIN_SOURCES_FOR_ARC: 2,
  MIN_ITEMS_FOR_ARC: 2,
  CANDIDATE_WINDOW_HOURS: 24,
  CANDIDATE_TTL_HOURS: 48,
  
  // 生命周期
  STALE_AFTER_HOURS: 48,
  ARCHIVE_AFTER_HOURS: 168,  // 7天
  CLEANUP_ITEMS_AFTER_DAYS: 30,
  CLEANUP_ARC_AFTER_DAYS: 90,
  
  // Buzz
  BUZZ_WINDOW_HOURS: 6,
  BUZZ_MIN_SOURCES: 3,
  BUZZ_MIN_ITEMS: 3,
  
  // LLM
  LLM_BATCH_SIZE: 10,
  LLM_QUEUE_INTERVAL_MS: 30_000,
  SUMMARY_UPDATE_INTERVAL_HOURS: 2,
  
  // 缓存
  SNAPSHOT_REFRESH_INTERVAL_MS: 5 * 60 * 1000,  // 5分钟
} as const;
```

## 附录 C: Drizzle Migration SQL（参考）

```sql
-- story_arcs 表增强
ALTER TABLE story_arcs ADD COLUMN keywords TEXT DEFAULT '[]';
ALTER TABLE story_arcs ADD COLUMN source_count INTEGER DEFAULT 0;
ALTER TABLE story_arcs ADD COLUMN buzz_score REAL DEFAULT 0;
ALTER TABLE story_arcs ADD COLUMN summary_updated_at INTEGER;
ALTER TABLE story_arcs ADD COLUMN title_source TEXT DEFAULT 'rule';
ALTER TABLE story_arcs ADD COLUMN merged_into_id TEXT;
ALTER TABLE story_arcs ADD COLUMN updated_at INTEGER;

-- story_arcs 字段重命名（SQLite 不直接支持 RENAME，需重建表）
-- first_seen → first_seen_at
-- last_updated → last_item_at
-- 删除: position, timeline

-- 索引
CREATE INDEX idx_story_arcs_status ON story_arcs(status);
CREATE INDEX idx_story_arcs_user_status ON story_arcs(user_id, status);
CREATE INDEX idx_story_arcs_last_item ON story_arcs(last_item_at);
CREATE INDEX idx_story_arcs_buzz ON story_arcs(buzz_score);

-- arc_items 表增强
ALTER TABLE arc_items ADD COLUMN relevance_score REAL DEFAULT 1.0;
ALTER TABLE arc_items ADD COLUMN is_key_event INTEGER DEFAULT 0;
ALTER TABLE arc_items ADD COLUMN headline TEXT;

CREATE UNIQUE INDEX idx_arc_items_unique ON arc_items(arc_id, item_id);
CREATE INDEX idx_arc_items_arc ON arc_items(arc_id);
CREATE INDEX idx_arc_items_item ON arc_items(item_id);

-- 新表: buzz_events
CREATE TABLE buzz_events (
  id TEXT PRIMARY KEY,
  arc_id TEXT REFERENCES story_arcs(id),
  entity_cluster TEXT NOT NULL DEFAULT '[]',
  source_ids TEXT NOT NULL DEFAULT '[]',
  item_ids TEXT NOT NULL DEFAULT '[]',
  score REAL NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  alerted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_buzz_events_score ON buzz_events(score);
CREATE INDEX idx_buzz_events_created ON buzz_events(created_at);
```

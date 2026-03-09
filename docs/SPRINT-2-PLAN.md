# Sprint 2 — Story Arc 增强 + Digest-Arc 深度集成

> **作者**：系统架构师  
> **日期**：2026-03-09  
> **前置**：Sprint 1（Story Arc MVP，PR #4 已合并）  
> **预估总工时**：~42h（约 5.5 个工作日）

---

## 目录

1. [Sprint 1 审查总结](#1-sprint-1-审查总结)
2. [Sprint 2 目标和范围](#2-sprint-2-目标和范围)
3. [任务拆解](#3-任务拆解)
4. [技术方案](#4-技术方案)
5. [依赖关系和优先级](#5-依赖关系和优先级)
6. [工时预估](#6-工时预估)
7. [验收标准](#7-验收标准)

---

## 1. Sprint 1 审查总结

### 1.1 Sprint 1 交付内容

Sprint 1（PR #4 `611715d`）在 Milestone 3 Phase 2 的框架下完成了 Story Arc 的 **MVP 核心流水线**，具体包括：

| 模块 | 文件 | 状态 |
|------|------|------|
| 类型系统 | `arc/types.ts` + `shared/types/arc.ts` | ✅ 完成 |
| 实体提取器 | `arc/entity-extractor.ts` | ✅ 完成（规则层） |
| 匹配引擎 | `arc/matcher.ts`（含 SnapshotCache） | ✅ 完成 |
| 候选池 | `arc/candidate-pool.ts` | ✅ 完成 |
| 主入口 | `arc/index.ts`（processItemForArc） | ✅ 完成 |
| 生命周期 | `arc/lifecycle.ts` | ✅ 完成 |
| 工具函数 | `arc/utils.ts`（stats, merge, buzzScore） | ✅ 完成 |
| API 路由 | `routes/arcs.ts`（CRUD + 合并） | ✅ 完成 |
| 前端列表 | `pages/Arcs.tsx` | ✅ 完成 |
| 前端详情 | `pages/ArcDetail.tsx`（时间线视图） | ✅ 完成 |
| DB Schema | `storyArcs`, `arcItems`, `buzzEvents` 表 | ✅ 完成 |
| Pipeline 集成 | `store.ts` → `processItemForArc` | ✅ 完成 |
| 调度集成 | `index.ts` Arc lifecycle cron（每小时） | ✅ 完成 |

### 1.2 代码质量评估

**优点：**

1. **架构清晰**：Arc 引擎的分层设计（extractor → matcher → candidate-pool → index）职责分明，单向数据流。
2. **性能意识好**：`ArcSnapshotCache` 进程级单例 + 5 分钟刷新 + 热路径写穿缓存（`upsert`/`remove`），避免了 hot-path 上的 DB 查询。
3. **匹配算法多信号**：Jaccard（entity 重叠）+ Dice（标题 bigram）+ 时间衰减三路加权，比单一信号鲁棒。
4. **候选池设计合理**：`candidateMinItems=2` + `candidateMinSources=2` 防止单源噪声创建垃圾 Arc；48h 过期自动清理。
5. **前端时间线视图完整**：ArcDetail 的时间线 UI 支持关键事件高亮、来源标注、标题内联编辑。
6. **API 功能完整**：列表/详情/编辑/删除/合并全部覆盖，合并逻辑处理了 timeline 合并、entity 合并、cache 同步。
7. **与 Push 系统无耦合**：Arc 模块纯粹做聚合，不侵入推送流程。

**遗留问题 & 改进空间：**

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| L1 | **无 LLM 增强** | 中 | 标题全部是 `"{entity} 事件进展"` 规则拼接（`titleSource: 'rule'`），`summary` 始终为 `null`。用户看到的标题信息量低。 |
| L2 | **Entity 提取仅规则层** | 中 | `entity-extractor.ts` 依赖 ~60 个硬编码实体 + 正则启发式。对不在列表中的实体（如新兴公司、人名）完全漏检，导致 Arc 匹配覆盖度不足。 |
| L3 | **无自动合并** | 低 | 设计文档中描述的"定期扫描 active Arcs 检测合并"未实现。手动合并 API 存在，但无自动检测。类似事件可能产生多条冗余 Arc。 |
| L4 | **Buzz 引擎未实现** | 中 | `buzzEvents` 表和 `buzzScore` 字段已存在，但 Buzz 检测引擎（跨源热度检测）尚未实现。当前 `buzzScore` 由 `computeBuzzScore(itemCount, sourceCount)` 简单公式生成，非真正的跨源 buzz 信号。 |
| L5 | **Digest-Arc 未集成** | 中 | Digest pipeline 不感知 Arc：不在摘要中标注文章所属故事线、无 Buzz 热点板块、无 Serendipity。`digests.arcIds` 字段存在但始终为空。 |
| L6 | **Digest 不含 Arc 上下文** | 低 | AI enhance（`ai-enhance.ts`）独立于 Arc 运行，不传入文章所属 Arc 的上下文。如果一篇文章属于 "OpenAI GPT-5" Arc，AI 生成的摘要/为什么重要应考虑故事线历史。 |
| L7 | **CandidatePool 内存级** | 低 | 候选池是进程内 Map，服务重启后丢失。MVP 可接受，但长期需持久化或恢复机制。 |
| L8 | **无测试** | 中 | 整个项目零测试文件。Arc 匹配算法（阈值调优）、entity 提取（覆盖度验证）、候选池（并发/边界条件）均缺乏测试保障。 |
| L9 | **timeline 字段冗余** | 低 | `storyArcs.timeline`（JSON 列表）与 `arcItems` 表数据重复。前端详情页已直接查 `arcItems`，但 timeline 字段仍在创建/更新时维护。 |
| L10 | **前端无分页加载** | 低 | `Arcs.tsx` 固定 `limit=20&offset=0`，无"加载更多"或分页。Arc 数量增长后体验退化。 |

### 1.3 现有系统状态

- **Push 系统**：Telegram 推送已实现并可用（PR #2, #3），支持 quiet hours、重试、push logs。
- **Digest 系统**：AI enhance pipeline 完整（分类、翻译、摘要、背景注入、为什么重要），Flash/Daily/Deep 三种格式。
- **Feed 采集**：RSS/Atom 采集 + 去重 + 源多样性 ranking 已稳定。
- **源多样性**：ranking.ts 已实现 `sourceDiversityDecay` 和 `maxPerSource`。

---

## 2. Sprint 2 目标和范围

### 2.1 目标

> **让 Story Arc 从"能用"升级到"好用"：AI 生成标题和摘要、Digest 中引用故事线、Buzz 热度引擎上线。**

Sprint 2 聚焦三条主线：

1. **LLM 增强**（L1, L2）：让 Arc 拥有有意义的标题和摘要，提升 entity 覆盖度
2. **Digest-Arc 集成**（L5, L6）：Digest 输出中引用故事线上下文，填充 `digests.arcIds`
3. **Buzz 引擎 MVP**（L4）：真正的跨源热度检测，取代简单公式

### 2.2 不在范围内

以下功能明确延后到 Sprint 3+：

- Buzz Alert 推送（依赖 Buzz 引擎稳定后）
- Serendipity slot（依赖 Buzz 引擎）
- 自动 Arc 合并（可继续用手动合并过渡）
- CandidatePool 持久化（L7，当前进程级可接受）
- 前端分页 / 无限滚动（L10，低优先级）
- E2E / 集成测试（独立 Sprint 或持续补充）

---

## 3. 任务拆解

### 3.1 主线 A：LLM 增强 Arc（~18h）

#### A1. Arc LLM 异步队列基础设施
**类型**：后端  
**文件**：新建 `packages/backend/src/engine/arc/llm-queue.ts`  
**说明**：
- 实现 `ArcLLMQueue` 类：内存任务队列，支持 `enqueue(task)` + 自动批量处理
- 任务类型：`title_generate`、`summary_update`、`entity_enhance`
- 处理节奏：每 30s 处理一批（`BATCH_SIZE=5`），避免 LLM 并发爆炸
- 集成 `getLLMClient()` 单例
- 降级策略：LLM 不可用时静默跳过，不影响主流程
- 在 `index.ts` 中随 server 启动初始化队列

**预估**：3h

#### A2. LLM Arc 标题生成
**类型**：后端  
**文件**：修改 `arc/index.ts`，新增 prompt 逻辑到 `llm-queue.ts`  
**说明**：
- 当 `createArcFromCandidateGroup()` 创建新 Arc 后，入队 `title_generate` 任务
- Prompt 输入：候选 items 的标题列表 + 共享 entities
- Prompt 输出：10-20 字的中文故事线标题
- 生成后更新 `storyArcs.title` + `titleSource = 'llm'`
- 同步更新 SnapshotCache
- 需处理边界：LLM 返回空/异常时保留 rule title

**预估**：3h

#### A3. LLM Arc 摘要生成与增量更新
**类型**：后端  
**文件**：修改 `arc/index.ts` + `llm-queue.ts`  
**说明**：
- 当 `addItemToArc()` 为已有 Arc 添加新 item 后，检查是否需要更新摘要
- 节流：`summaryUpdatedAt` 距今 ≥ 2h 才触发（避免频繁调用）
- Prompt 输入：Arc title + entities + timeline（最近 10 条 headline）
- Prompt 输出：100-200 字中文摘要，按时间线梳理事件发展
- 更新 `storyArcs.summary` + `summaryUpdatedAt`
- 首次创建 Arc 时也触发摘要生成（无需节流）

**预估**：3h

#### A4. LLM 增强 Entity 提取
**类型**：后端  
**文件**：修改 `arc/entity-extractor.ts` + `llm-queue.ts` + `arc/index.ts`  
**说明**：
- 新增 `extractEntitiesWithLLM(titles: string[]): Promise<Map<number, string[]>>`
- 批量处理：每 10 条 items 一次 LLM 调用
- Prompt：从标题+内容提取 3-5 个关键实体（人名、公司、产品、地名、事件）
- 提取结果回写到 `feedItems.entities`（合并，不覆盖规则提取的）
- 回写后重新调用 `processItemForArc()`，让新 entity 触发更精确的匹配
- **重要**：避免重复处理——在 `feedItems` 上添加标记字段 `entityEnhanced` 或用内存 Set 跟踪已处理 itemId
- 降级：LLM 不可用时跳过，纯依赖规则提取（现有行为不变）

**预估**：4h

#### A5. 扩展硬编码 Entity 列表
**类型**：后端  
**文件**：修改 `arc/entity-extractor.ts`  
**说明**：
- 将 `KNOWN_ENTITIES` 从 ~60 个扩展到 ~200 个
- 新增类别：AI 模型名（GPT-5, Llama 3, Mistral, Gemini 等）、金融（Fed, ECB, IMF, OPEC）、地缘热点（Gaza, Iran, North Korea）、科技产品（Vision Pro, Copilot, Sora, Midjourney）
- 新增中文人名高频姓氏覆盖（当前 31 个，可扩展到 50+）
- 新增中文机构后缀匹配（当前仅匹配"公司/集团/大学..."，增加"协会/基金/联盟/平台/工厂"等）
- 纯数据变更，不改算法

**预估**：2h

#### A6. 前端摘要展示优化
**类型**：前端  
**文件**：修改 `ArcDetail.tsx` + `Arcs.tsx`  
**说明**：
- `ArcDetail.tsx`：摘要卡片已存在（`arc.summary && <Card>`），但 Sprint 1 中 summary 始终为 null。LLM 摘要上线后需验证渲染效果，调整排版
- `Arcs.tsx` 列表卡片：添加 summary 的 1-2 行预览（truncate 到 80 字）
- 标题旁显示 `titleSource` 徽标：LLM 生成 vs 规则生成 vs 用户编辑
- 如果 summary 为 null，显示最近 3 条 timeline headline 作为 fallback

**预估**：3h

---

### 3.2 主线 B：Digest-Arc 集成（~12h）

#### B1. Digest Pipeline 注入 Arc 上下文
**类型**：后端  
**文件**：修改 `digest/pipeline.ts` + 新建 `digest/arc-context.ts`  
**说明**：
- 新建 `getItemArcMap(itemIds: string[], userId: string): Promise<Map<string, { arcId: string; arcTitle: string; arcStatus: ArcStatus }>>`
  - 查询 `arcItems` + `storyArcs`，返回 itemId → Arc 信息的映射
- 在 pipeline 的 step 5（AI Enhancement）之后、step 6（Render）之前注入：
  - 将 Arc 上下文附加到每个 `EnhancedItem` 上
  - 新增 `EnhancedItem.arcInfo?: { id: string; title: string; status: string }` 字段
- 收集所有出现的 arcIds，写入 `digests.arcIds`（当前始终为空）
- 不改变现有 pipeline 的失败语义——Arc 查询失败时静默跳过

**预估**：3h

#### B2. Digest Renderer 添加 Arc 标注
**类型**：后端  
**文件**：修改 `digest/renderer.ts`  
**说明**：
- 在 `renderDailyEnhanced()` 和 `renderDeepEnhanced()` 中：
  - 每条 item 末尾添加故事线引用：`📖 故事线：[{arcTitle}](/arcs/{arcId})`
  - Markdown 和 HTML 双格式
- Flash 格式不加标注（保持简洁）
- 如果一条 item 属于多个 Arc（理论上可能），只显示 relevance 最高的一个

**预估**：2h

#### B3. Telegram 推送格式适配 Arc 标注
**类型**：后端  
**文件**：修改 `push/channels/telegram.ts`  
**说明**：
- `parseMarkdownSections()` 需识别新增的 `📖 故事线：...` 行
- 在 Telegram HTML 格式中渲染为 `📖 <a href="...">故事线标题</a>`
- 确保不影响现有 Flash/Daily/Deep 的 Telegram 格式

**预估**：2h

#### B4. AI Enhance 增加 Arc 上下文
**类型**：后端  
**文件**：修改 `digest/ai-enhance.ts`  
**说明**：
- 当一条 item 属于某个 Arc 时，在 prompt 中追加上下文：
  - `该新闻属于故事线「{arcTitle}」（{arcSummary 前50字}...），请据此生成 whyImportant`
- 目标：让 AI 生成的"为什么重要"考虑故事线历史背景，而非孤立分析
- 需要从 pipeline 向 `aiEnhanceItems()` 传入 `itemArcMap`——修改函数签名，添加可选参数
- 仅在 Arc 有 summary 时注入（无 summary 时不传，避免噪声）

**预估**：3h

#### B5. Digest 新增 Buzz 热点板块（Stub）
**类型**：后端  
**文件**：修改 `digest/renderer.ts` + `digest/pipeline.ts`  
**说明**：
- 在 Daily/Deep digest 末尾添加 "🔥 热点事件" 板块
- 数据来源：查询最近 24h 内 `buzzScore` 最高的 3 个 active Arc
- 渲染格式：`🔥 {arcTitle} — {sourceCount} 个源报道 · {itemCount} 条新闻`
- 这是对完整 Buzz 引擎的 **lightweight 前置**——先用 Arc 的 buzzScore 排序，Sprint 2 Buzz 引擎上线后替换数据源

**预估**：2h

---

### 3.3 主线 C：Buzz 引擎 MVP（~12h）

#### C1. Buzz 检测引擎
**类型**：后端  
**文件**：新建 `packages/backend/src/engine/arc/buzz-detector.ts`  
**说明**：
- 实现 `BuzzDetector` 类
- 检测逻辑：在 `processInsertedItemsForArcs()` 后运行
  - 查询最近 `BUZZ_WINDOW_HOURS=6h` 内所有 items 的 entities
  - 构建 entity → items 倒排索引
  - 检测同一 entity 在 `MIN_SOURCES=3` 个不同源出现 `MIN_ITEMS=3` 次以上
- Buzz 分数公式：`score = sourceCount × log2(itemCount + 1) × (1 + velocity)`
  - `velocity = itemCount / windowHours`
- 合并相似 buzz 事件（共享 >50% items 的合并为一个，保留最高分）
- 结果写入 `buzzEvents` 表
- 关联已有 Arc：查找 entities 匹配的 active Arc，更新 `storyArcs.buzzScore`

**预估**：5h

#### C2. Buzz 检测集成到 Pipeline
**类型**：后端  
**文件**：修改 `engine/store.ts`  
**说明**：
- 在 `processInsertedItemsForArcs()` 完成后，调用 `buzzDetector.detect(newItems)`
- 注意性能：Buzz 检测需要一次 DB 查询（最近 6h items）+ 内存计算，预算 <200ms
- 如果检测到 buzz 且无对应 Arc，可触发 Arc 创建（复用 CandidatePool 逻辑或直接创建）
- 异常不影响主流程——catch + warn

**预估**：2h

#### C3. Buzz API 端点
**类型**：后端  
**文件**：新建 `packages/backend/src/routes/buzz.ts` + 修改 `index.ts` 注册路由  
**说明**：
- `GET /api/v1/buzz` — 最近 buzz 事件列表
  - Query params: `limit`, `hours`（时间窗口）
  - 返回 buzzEvents + 关联的 Arc 基本信息
- `GET /api/v1/buzz/top` — 热门排行（最近 24h，按 score 降序）
  - Left join storyArcs 返回 Arc 标题
- 需 requireAuth

**预估**：2h

#### C4. 前端 Buzz 概览（Dashboard 嵌入）
**类型**：前端  
**文件**：修改 Dashboard 页面（或 `Arcs.tsx` 顶部）  
**说明**：
- 不新建独立 Buzz 页面——在 Arcs 列表页顶部添加 "🔥 热点事件" 横幅
- 显示 top 3 buzz 事件：entity 名称 + 源数 + 关联 Arc 链接
- 点击跳转到 Arc 详情
- 无 buzz 事件时不显示

**预估**：3h

---

## 4. 技术方案

### 4.1 Arc LLM Queue 设计

```typescript
// packages/backend/src/engine/arc/llm-queue.ts

type ArcLLMTaskType = 'title_generate' | 'summary_update' | 'entity_enhance';

interface ArcLLMTask {
  type: ArcLLMTaskType;
  arcId?: string;         // title_generate, summary_update
  itemIds?: string[];     // entity_enhance
  payload?: Record<string, unknown>;
  createdAt: number;
}

export class ArcLLMQueue {
  private queue: ArcLLMTask[] = [];
  private processing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly BATCH_SIZE = 5;
  private readonly INTERVAL_MS = 30_000;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.processBatch(), this.INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  enqueue(task: ArcLLMTask): void {
    // 去重：同 arcId 同 type 的任务不重复入队
    const isDup = this.queue.some(
      t => t.type === task.type && t.arcId === task.arcId
    );
    if (!isDup) {
      this.queue.push({ ...task, createdAt: Date.now() });
    }
  }

  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    try {
      const batch = this.queue.splice(0, this.BATCH_SIZE);
      for (const task of batch) {
        await this.executeTask(task);
      }
    } finally {
      this.processing = false;
    }
  }

  private async executeTask(task: ArcLLMTask): Promise<void> {
    // dispatch by task.type → 调用对应的 LLM prompt 函数
  }
}
```

**设计决策**：
- 使用 `setInterval` 而非事件驱动，简单可靠
- 去重防止同一 Arc 短时间内入队多次 summary_update
- 单进程运行，无需分布式锁

### 4.2 Prompt 设计

#### 标题生成 Prompt

```
你是一位资深新闻编辑。以下是一组相关新闻的标题：

{titles}

共享的关键实体：{entities}

请为这组新闻生成一个简洁的"故事线标题"：
1. 10-20 个中文字
2. 概括整个事件的主题，不要是某条新闻的标题
3. 用中文
4. 不要标点符号

示例：中东冲突与停火谈判进展 / OpenAI GPT-5 发布引发行业洗牌 / 特斯拉 Q4 财报与股价波动

只返回标题文字。
```

#### 摘要生成 Prompt

```
你是一位新闻编辑。以下是一条新闻故事线的时间线：

标题：{arcTitle}
关键实体：{entities}

时间线（按时间排序）：
{timeline entries, each: "YYYY-MM-DD: headline"}

请生成 100-150 字的中文摘要：
1. 按时间顺序梳理事件发展脉络
2. 突出关键转折点
3. 最后一句总结当前状态或展望
4. 不要使用标题格式或 markdown

只返回摘要文字。
```

#### 增强 Entity 提取 Prompt

```
从以下 {N} 条新闻中提取关键实体（人名、公司、产品、地名、事件名）。

{numbered list of "title + content snippet"}

返回 JSON 数组，格式：
[{"id": 1, "entities": ["OpenAI", "GPT-5"]}, ...]

每条提取 3-5 个最重要的实体。只返回 JSON。
```

### 4.3 Buzz 检测算法

```
输入：最近 6h 内所有 feedItems（entities 字段）
处理：
  1. 构建 entity → [{itemId, sourceId}] 倒排索引
  2. 筛选 sourceCount ≥ 3 && itemCount ≥ 3 的 entity
  3. 计算 buzzScore = sourceCount × log2(itemCount + 1) × (1 + itemCount/6)
  4. 合并 item 重叠 >50% 的 buzz 事件
  5. 关联已有 Arc（entity 交集匹配）
输出：BuzzEvent[]
```

**性能预算**：单次检测 < 200ms（1 次 DB 查询 + 内存计算）

### 4.4 数据模型变更

**无 Schema 变更**。Sprint 1 已经预建了所有需要的表和字段：
- `storyArcs.summary`、`summaryUpdatedAt`、`titleSource`、`buzzScore` ✅
- `buzzEvents` 表 ✅
- `digests.arcIds` ✅

需要的唯一变更是在 `ai-enhance.ts` 的 `EnhancedItem` 接口上扩展 `arcInfo` 字段（TypeScript 层面，非 DB）。

### 4.5 API 新增/变更

| 方法 | 路径 | 说明 | 新增/变更 |
|------|------|------|---------|
| `GET` | `/api/v1/buzz` | Buzz 事件列表 | 新增 |
| `GET` | `/api/v1/buzz/top` | 热门 Buzz 排行 | 新增 |

现有 Arc API 无变更。

---

## 5. 依赖关系和优先级

### 5.1 依赖图

```
A1 (LLM Queue 基础设施)
  ├── A2 (标题生成)         → A6 (前端摘要展示)
  ├── A3 (摘要生成)         → A6 + B4 (AI Enhance + Arc 上下文)
  └── A4 (Entity 增强提取)

A5 (扩展 Entity 列表)      ← 独立，可并行

B1 (Pipeline Arc 上下文)
  ├── B2 (Renderer Arc 标注)  → B3 (Telegram 适配)
  └── B4 (AI Enhance + Arc 上下文)

B5 (Buzz 热点板块 Stub)    ← 可独立先做，用现有 buzzScore

C1 (Buzz 检测引擎)
  ├── C2 (Pipeline 集成)
  ├── C3 (Buzz API)         → C4 (前端 Buzz 概览)
  └── B5 (升级 Stub 为真实数据)
```

### 5.2 优先级排序

| 优先级 | 任务 | 原因 |
|--------|------|------|
| 🔴 P0 | A1 LLM Queue | 阻塞所有 LLM 增强任务 |
| 🔴 P0 | A5 扩展 Entity | 独立、零风险、立即提升覆盖度 |
| 🔴 P0 | A2 标题生成 | 用户最直接感知的质量提升 |
| 🔴 P0 | A3 摘要生成 | 故事线核心价值 |
| 🟠 P1 | B1 Pipeline Arc 上下文 | 阻塞 B2, B4 |
| 🟠 P1 | B2 Renderer Arc 标注 | Digest 质量提升 |
| 🟠 P1 | C1 Buzz 检测引擎 | 核心差异化功能 |
| 🟡 P2 | A4 Entity 增强提取 | LLM 成本较高，可渐进上线 |
| 🟡 P2 | B4 AI Enhance + Arc | 增量提升，非阻塞 |
| 🟡 P2 | C2 Buzz Pipeline 集成 | 依赖 C1 |
| 🟡 P2 | C3 Buzz API | 依赖 C1 |
| 🟢 P3 | A6 前端摘要展示 | 后端就绪后再调 |
| 🟢 P3 | B3 Telegram 适配 | 后端就绪后再调 |
| 🟢 P3 | B5 Buzz 热点板块 | 锦上添花 |
| 🟢 P3 | C4 前端 Buzz 概览 | 依赖 C3 |

### 5.3 建议执行顺序

```
Day 1 (8h):
  A5 扩展 Entity 列表 (2h)
  A1 LLM Queue 基础设施 (3h)
  A2 LLM 标题生成 (3h)

Day 2 (8h):
  A3 LLM 摘要生成 (3h)
  B1 Pipeline Arc 上下文 (3h)
  B2 Renderer Arc 标注 (2h)

Day 3 (8h):
  C1 Buzz 检测引擎 (5h)
  C2 Buzz Pipeline 集成 (2h)
  B3 Telegram 适配 (1h — 快速验证)

Day 4 (8h):
  A4 Entity 增强提取 (4h)
  B4 AI Enhance + Arc 上下文 (3h)
  C3 Buzz API (1h)

Day 5 (6h):
  A6 前端摘要展示 (3h)
  C4 前端 Buzz 概览 (2h — 简化版)
  B5 Buzz 热点板块 (1h — 如果时间充裕)

Buffer: 4h（Bug 修复、调优、边界情况处理）
```

---

## 6. 工时预估

| 任务 ID | 任务名称 | 预估 | 类型 |
|---------|---------|------|------|
| A1 | LLM Queue 基础设施 | 3h | 后端 |
| A2 | LLM 标题生成 | 3h | 后端 |
| A3 | LLM 摘要生成 | 3h | 后端 |
| A4 | LLM Entity 增强提取 | 4h | 后端 |
| A5 | 扩展 Entity 列表 | 2h | 后端 |
| A6 | 前端摘要展示优化 | 3h | 前端 |
| B1 | Pipeline Arc 上下文 | 3h | 后端 |
| B2 | Renderer Arc 标注 | 2h | 后端 |
| B3 | Telegram 适配 Arc 标注 | 2h | 后端 |
| B4 | AI Enhance + Arc 上下文 | 3h | 后端 |
| B5 | Buzz 热点板块（Stub） | 2h | 后端 |
| C1 | Buzz 检测引擎 | 5h | 后端 |
| C2 | Buzz Pipeline 集成 | 2h | 后端 |
| C3 | Buzz API | 2h | 后端 |
| C4 | 前端 Buzz 概览 | 3h | 前端 |
| — | **总计** | **42h** | — |
| — | Buffer（调优/Bug 修复） | +4h | — |
| — | **含 Buffer 总计** | **46h** | — |

---

## 7. 验收标准

### 7.1 LLM 增强

- [ ] 新创建的 Arc 在 30s 内获得 LLM 生成的中文标题（`titleSource = 'llm'`）
- [ ] 有 3+ items 的 active Arc 拥有 100-200 字的中文摘要
- [ ] 摘要在 Arc 获得新 item 后 2h 内自动更新
- [ ] LLM 不可用（`LLM_PROVIDER=none`）时，系统行为与 Sprint 1 完全一致（纯规则标题、无摘要）
- [ ] 扩展后的 entity 列表覆盖 200+ 常见实体

### 7.2 Digest-Arc 集成

- [ ] Daily/Deep digest 的每条 item 旁标注所属故事线（如果有）
- [ ] `digests.arcIds` 字段正确填充关联的 Arc ID
- [ ] AI 生成的"为什么重要"在有 Arc 上下文时能引用故事线背景
- [ ] Telegram 推送正确渲染故事线标注链接
- [ ] Daily digest 末尾包含 "🔥 热点事件" 板块（top 3 buzzScore Arc）

### 7.3 Buzz 引擎

- [ ] 同一事件在 6h 内被 3+ 不同源报道时，自动检测为 buzz 事件
- [ ] Buzz 事件写入 `buzzEvents` 表，并关联对应的 Arc
- [ ] `GET /api/v1/buzz/top` 返回最近 24h 的热门事件排行
- [ ] 前端 Arcs 页面顶部展示 buzz 概览

### 7.4 非功能性

- [ ] Buzz 检测单次耗时 < 200ms
- [ ] LLM Queue 不阻塞采集 pipeline（完全异步）
- [ ] 服务启动后 LLM Queue 自动初始化

---

*Sprint 2 Plan — Generated 2026-03-09*

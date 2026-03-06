# ArcLight — 产品文档

**副标题**：理解人类新闻消费习惯的智能信息助手

**版本**：v2.0 Draft
**日期**：2026-03-06
**作者**：Fadacai（基于与主人的讨论）

---

## 目录

1. [核心理念](#1-核心理念)
2. [人类新闻消费模型](#2-人类新闻消费模型)
3. [产品定位与差异化](#3-产品定位与差异化)
4. [功能架构总览](#4-功能架构总览)
5. [Feature 1：信息分层引擎](#5-feature-1信息分层引擎)
6. [Feature 2：Story Arc 故事线追踪](#6-feature-2story-arc-故事线追踪)
7. [Feature 3：Source Tier 信源分级](#7-feature-3source-tier-信源分级)
8. [Feature 4：Buzz Signal 谈资指数](#8-feature-4buzz-signal-谈资指数)
9. [Feature 5：Serendipity 视野扩展](#9-feature-5serendipity-视野扩展)
10. [Feature 6：Context Injection 背景注入](#10-feature-6context-injection-背景注入)
11. [Feature 7：Consumption Memory 消费记忆](#11-feature-7consumption-memory-消费记忆)
12. [Feature 8：场景化推送](#12-feature-8场景化推送)
13. [Schema 演进](#13-schema-演进)
14. [架构演进](#14-架构演进)
15. [配置设计](#15-配置设计)
16. [实施路线图](#16-实施路线图)
17. [成功指标](#17-成功指标)
18. [风险与约束](#18-风险与约束)
19. [附录：竞品参考](#19-附录竞品参考)

---

## 1. 核心理念

### v1 做了什么

Universal Feeds v1 解决了一个基础问题：**从多个平台抓取内容 → 去重 → 排序 → 输出一份 daily digest**。它是一个技术上正确的 RSS 聚合器。

### v1 缺了什么

v1 把新闻消费简化成了一个单一动作——"每天给我一份列表"。但人类消费信息的方式远比这复杂：

- 不同时间段需要不同深度的信息
- 关注的是"事件的发展"而不是"一条条新闻"
- 有社交需求（"别人在讨论什么"）
- 需要上下文才能理解新闻
- 偶尔想要被意外的发现惊喜
- 随着使用，期望工具越来越懂自己

### v2 的目标

**不做又一个 RSS 聚合器，做一个理解人类新闻消费习惯的智能信息助手。**

核心原则：

1. **尊重人类注意力的稀缺性**——不是给更多信息，而是在对的时间给对的深度
2. **新闻是连续剧，不是独立电影**——追踪事件发展，而非罗列标题
3. **信息消费有社交属性**——帮用户知道"大家在聊什么"
4. **智能 ≠ 算法茧房**——主动拓展视野，而非加深偏好
5. **工具应该越用越懂你**——但用户始终掌控

---

## 2. 人类新闻消费模型

这是整个 v2 设计的基础。我们从五个维度理解人类如何消费新闻：

### 2.1 时间-模式矩阵

人在一天中的不同时段，消费新闻的模式完全不同：

| 时段 | 模式 | 行为 | 深度 | 典型时长 |
|------|------|------|------|----------|
| 刚醒来 (7-8am) | **速览 Scan** | 扫标题 | Level 0-1 | 1-3 分钟 |
| 通勤/碎片 (8-10am) | **选读 Pick** | 点进 1-2 篇 | Level 2 | 5-10 分钟 |
| 午间 (12-1pm) | **刷 Browse** | 社交媒体式 | Level 0-1 | 10-15 分钟 |
| 工作间隙 (2-5pm) | **监控 Monitor** | 行业/专业 | Level 1-2 | 碎片 |
| 晚间放松 (8-10pm) | **深读 Deep** | 长文/播客 | Level 2-3 | 20-40 分钟 |
| 突发事件 | **跟踪 Track** | 多源刷新 | Level 3-4 | 不定 |

**设计启示**：一份 digest 不够。需要根据时段提供不同粒度的输出。

### 2.2 消费深度金字塔

```
                    ▲
                   ╱ ╲         Level 4: 多源交叉验证（<0.5%）
                  ╱   ╲        — "各家怎么报道？有没有偏见？"
                 ╱─────╲
                ╱       ╲      Level 3: 持续追踪后续（~1%）
               ╱         ╲     — "这事后来怎么样了？"
              ╱───────────╲
             ╱             ╲   Level 2: 读完全文（~4%）
            ╱               ╲   — "我对这个感兴趣，让我看看"
           ╱─────────────────╲
          ╱                   ╲ Level 1: 标题+一句话（~15%）
         ╱                     ╲ — "大概知道怎么回事"
        ╱───────────────────────╲
       ╱                         ╲ Level 0: 标题扫过（~80%）
      ╱                           ╲ — "知道了，下一条"
     ╱─────────────────────────────╲
```

**设计启示**：对 80% 的新闻，标题本身就是全部产品。标题的质量（清晰、信息密度）比正文摘要更重要。

### 2.3 消费动机图谱

```
        功利性                社交货币
   "这事影响我"           "明天能聊这个"
        ●─────────┬─────────●
                  │
                  │
   好奇心 ●───────┼───────● FOMO
  "有意思"        │      "别错过"
                  │
                  │
                  ●
              情绪需求
          "让我放松/激励"
```

五种动机经常在同一次浏览中交替出现。用户自己可能都不清楚"我为什么在看这个"——但产品需要理解。

**设计启示**：
- 功利性 → 按 topic 精准匹配
- 社交货币 → buzz/热度信号
- 好奇心 → serendipity 推荐
- FOMO → 突发/breaking 标记
- 情绪 → 轻松/正能量分区（类似 WorldMonitor 的 happy variant）

### 2.4 信息发现路径

人获取新闻的方式不是单一的：

```
策展推送 ──────────── 40%  "编辑/算法帮我选好"
  │
社交传播 ──────────── 25%  "朋友分享/群里讨论的"
  │
偶遇 serendipity ─── 15%  "本来没想看，但标题吸引了"
  │
主动搜索 ──────────── 12%  "我想知道X的最新情况"
  │
习惯性巡视 ────────── 8%   "每天早上看那几个固定网站"
```

**设计启示**：Universal Feeds 主要是"策展推送"角色，但需要模拟其他路径——尤其是偶遇和社交传播。

### 2.5 故事线认知

这是被现有工具忽视最严重的一点。

**人脑不存储"一条条新闻"，人脑存储"故事"。**

当用户看到"OpenAI 任命新 CTO"时，他的大脑会自动关联：
- "之前那次 CEO 被开除的事"
- "Sam Altman 回归后公司怎么样了"
- "这对 Anthropic / Google 竞争格局意味着什么"

一条新闻在用户脑中是一个**故事线的最新节点**，不是一个孤立事实。

**设计启示**：Story Arc 是 v2 最核心的差异化功能。把零散的新闻组织成故事线，帮用户看到事件的脉络和发展。

---

## 3. 产品定位与差异化

### 3.1 我们是什么

| 维度 | Universal Feeds v2 |
|------|-------------------|
| **一句话定位** | 理解人类新闻消费习惯的智能信息助手 |
| **用户** | 信息密集型工作者（开发者、产品经理、创业者） |
| **核心价值** | 在对的时间，以对的深度，给对的信息 |
| **形态** | OpenClaw/Clawdbot Skill + CLI |
| **部署** | Self-hosted，本地运行 |

### 3.2 我们不是什么

- **不是新闻 App**：没有 UI，通过消息渠道（iMessage/Telegram/Discord）投递
- **不是 SaaS**：不替用户抓取，用户自己运行
- **不是算法推荐引擎**：不做 ML 推荐，用规则 + LLM 实现"聪明"
- **不是实时信息流**：不做 push notification 式的即时推送（那是 WorldMonitor 干的事）

### 3.3 竞品对比

| 能力 | RSS 阅读器 | Newsletter | WorldMonitor | **UF v2** |
|------|-----------|------------|-------------|-----------|
| 多源聚合 | ✅ | ❌ | ✅ | ✅ |
| 去重排序 | ❌ | 人工 | ✅ | ✅ |
| 故事线追踪 | ❌ | 部分 | 部分 | ✅ |
| 消费深度分层 | ❌ | 固定 | 固定 | ✅ |
| 场景化推送 | ❌ | 固定 | ❌ | ✅ |
| 社交热度信号 | ❌ | ❌ | 部分 | ✅ |
| Serendipity | ❌ | 人工 | ✅ (variants) | ✅ |
| 消费记忆 | 已读标记 | ❌ | ❌ | ✅ |
| 本地部署 | 部分 | ❌ | ✅ | ✅ |
| 中英双语 | 依赖源 | 依赖 | 21语言 | ✅ |

---

## 4. 功能架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                     Universal Feeds v2                          │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Adapters │  │ Adapters │  │ Adapters │  │ Adapters │  ...   │
│  │   RSS    │  │  X/bird  │  │  V2EX    │  │ YouTube  │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │             │
│       └──────────────┴──────┬───────┴──────────────┘             │
│                             │                                    │
│                    ┌────────▼────────┐                           │
│                    │  Normalize +    │  ← Source Tier 标注        │
│                    │  Enrich Layer   │  ← Language detect         │
│                    └────────┬────────┘                           │
│                             │                                    │
│              ┌──────────────┼──────────────┐                     │
│              │              │              │                     │
│     ┌────────▼──────┐ ┌────▼─────┐ ┌──────▼───────┐            │
│     │  Dedup +      │ │ Story    │ │ Buzz Signal  │            │
│     │  Clustering   │ │ Arc      │ │ Calculator   │            │
│     └────────┬──────┘ │ Engine   │ └──────┬───────┘            │
│              │        └────┬─────┘        │                     │
│              └─────────────┼──────────────┘                     │
│                            │                                    │
│                   ┌────────▼────────┐                           │
│                   │  Ranking Engine │  ← topic match             │
│                   │                 │  ← source tier              │
│                   │                 │  ← buzz score               │
│                   │                 │  ← recency                  │
│                   │                 │  ← story arc weight         │
│                   └────────┬────────┘                           │
│                            │                                    │
│              ┌─────────────┼─────────────┐                      │
│              │             │             │                      │
│     ┌────────▼──────┐ ┌───▼────┐ ┌──────▼───────┐             │
│     │ Context       │ │ Seren- │ │ Consumption  │             │
│     │ Injection     │ │ dipity │ │ Memory       │             │
│     └────────┬──────┘ │ Slot   │ └──────┬───────┘             │
│              │        └───┬────┘        │                      │
│              └────────────┼─────────────┘                      │
│                           │                                    │
│                  ┌────────▼────────┐                            │
│                  │  Multi-Tier     │                            │
│                  │  Renderer       │                            │
│                  │                 │                            │
│                  │ ┌─────────────┐ │                            │
│                  │ │ ⚡ Flash     │ │  8 titles, 60 sec          │
│                  │ ├─────────────┤ │                            │
│                  │ │ 📰 Daily    │ │  5-8 items + why           │
│                  │ ├─────────────┤ │                            │
│                  │ │ 🔍 Deep     │ │  1-2 long-form recs        │
│                  │ ├─────────────┤ │                            │
│                  │ │ 📊 Weekly   │ │  Story arc summaries       │
│                  │ └─────────────┘ │                            │
│                  └────────┬────────┘                            │
│                           │                                    │
│                  ┌────────▼────────┐                            │
│                  │  Delivery       │                            │
│                  │  Scheduler      │                            │
│                  │  (cron/manual)  │                            │
│                  └─────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Feature 1：信息分层引擎

### 问题

v1 只输出一种格式的 digest——不管用户是在起床扫两眼，还是晚上想深度阅读，拿到的都是同一份列表。

### 方案

同一批数据，切出多种粒度的输出：

| 层级 | 名称 | 内容 | 条数 | 阅读时长 | 典型投递时间 |
|------|------|------|------|---------|------------|
| **Flash** ⚡ | 60 秒速览 | 纯标题列表 | 8-10 | <1 min | 早 7:30 |
| **Daily** 📰 | 今日精选 | 标题 + 一句话"为什么值得看" + 链接 | 5-8 | 3-5 min | 早 9:00 |
| **Deep** 🔍 | 深度推荐 | 长摘要 + 背景上下文 + 观点 | 1-2 | 5-10 min | 晚 20:00 |
| **Weekly** 📊 | 周报 | Story arc 汇总 + 趋势 | 3-5 arcs | 10-15 min | 周日 10:00 |

### Flash 示例输出

```
⚡ 2026-03-06 速览

1. 欧盟 AI 法案合规执法首日，三家公司被调查
2. OpenAI 开源 GPT-5 推理模型权重
3. 苹果收购一家AR芯片初创
4. 美联储暗示6月可能降息
5. SpaceX 星舰第七次试飞成功回收
6. 微软裁员 Azure 部门 2000 人
7. 日本央行意外加息至 1.5%
8. DeepSeek 发布多模态 V3

链接已省略 → 回复"详情"看 Daily 版本
```

### Daily 示例输出

```
📰 2026-03-06 今日精选

1. 🔥 欧盟 AI 法案合规执法首日，三家公司被调查
   为什么重要：这是 AI Act 生效后的首次真正执法行动，将定义监管力度的基调
   → https://...

2. OpenAI 开源 GPT-5 推理模型权重
   为什么重要：首次开源旗舰级推理模型，直接冲击 Llama/Mistral 开源阵营格局
   → https://...

3. 📈 美联储暗示6月可能降息
   为什么重要：市场此前预期9月，提前信号意味着经济担忧加深
   → https://...

[...]

💡 意外发现：冰岛成为全球首个实现 100% 可再生能源供电的国家
→ https://...
```

### 渲染配置

```yaml
outputs:
  flash:
    enabled: true
    count: 8
    format: title_only
    schedule: "07:30"
    channel: imessage    # 投递到 iMessage

  daily:
    enabled: true
    count: 8
    format: title_with_why
    include_serendipity: true
    serendipity_slots: 1
    schedule: "09:00"
    channel: imessage

  deep:
    enabled: true
    count: 2
    format: long_summary_with_context
    schedule: "20:00"
    channel: imessage

  weekly:
    enabled: true
    format: story_arc_summary
    schedule: "sun 10:00"
    channel: imessage
```

### 实现要点

- Flash / Daily / Deep 共享同一个 ranking pipeline 的结果，只是在 renderer 层做不同切片
- Flash 取 top 8，Daily 取 top 8 + LLM 生成"为什么重要"，Deep 取 top 2 + LLM 生成长摘要 + 背景
- "为什么重要"是一次 LLM 调用，batch 处理 5-8 条标题，成本可控
- Weekly 需要 Story Arc 数据（见 Feature 2），是跨天聚合

---

## 6. Feature 2：Story Arc 故事线追踪

### 问题

用户看到的是一条条孤立的新闻标题。但在他的大脑里，新闻是按"故事"组织的："OpenAI 的那件事"、"AI 监管进展"、"中美关系最近怎样了"。现有 digest 完全不做这种关联。

### 核心概念

**Story Arc**：一组关于同一事件/主题的新闻条目，按时间串联，代表一个"故事"的发展脉络。

```
Story Arc: "欧盟 AI 法案"
├── 2026-02-15  欧盟 AI 法案进入最终审议阶段
├── 2026-02-28  法案正式生效，6个月过渡期开始
├── 2026-03-01  科技公司集体发声，批评合规成本
├── 2026-03-06  首批三家公司被调查（⬅ 最新）
│
└── 标签: #regulation #eu #ai-policy
    状态: 🔴 活跃（4 天内有更新）
    热度趋势: 📈 上升
```

### 架构

```
每日新 items
     │
     ▼
┌─────────────────┐
│ Arc Matcher      │  ← 尝试将每条新闻匹配到已有 Arc
│                  │  ← 匹配方法：entity overlap + 标题相似度 + LLM 判断
│                  │  ← 无法匹配 → 候选新 Arc（需达到阈值）
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Arc Store        │  ← 持久化存储：arcs.jsonl
│                  │  ← 每个 Arc 记录：id, title, items[], tags,
│                  │     status (active/dormant/closed),
│                  │     firstSeen, lastUpdated, itemCount
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Arc Renderer     │  ← Daily: 标注"📌 属于故事线: XXX"
│                  │  ← Weekly: 完整故事线回顾
│                  │  ← 唤醒: "沉寂15天的故事线有新进展"
└─────────────────┘
```

### 匹配策略（分层，逐步细化）

**Phase 1（MVP）**：基于 entity + keyword overlap

```
score = jaccard(entities_a, entities_b) * 0.6
      + jaccard(keywords_a, keywords_b) * 0.4
if score > 0.35 → 归入同一 Arc
```

Entity 提取用简单规则：大写词组、已知公司名、地名。

**Phase 2**：加入 LLM 判断

对 Phase 1 得分在 0.2-0.35 之间的"模糊区"，用 LLM 做一次确认：

```
Prompt: "以下两条新闻是否属于同一个事件/故事线？
A: {title_a}
B: {title_b}
回答 yes/no 并简要说明理由。"
```

**Phase 3**：embedding 相似度

对 item title 做 embedding，用余弦相似度 > 0.75 作为候选，再走 Phase 1-2 确认。

### Arc 生命周期

```
新建 (new)
  │
  │ ← 第二条相关新闻出现
  ▼
活跃 (active) ──→ 持续有新 items 加入
  │
  │ ← 超过 7 天无新 item
  ▼
休眠 (dormant) ──→ 有新 item 时被唤醒 → 回到 active
  │
  │ ← 超过 30 天无新 item
  ▼
关闭 (closed) ──→ 归档，不再匹配
```

### Daily Digest 中的 Story Arc 呈现

```
📰 2026-03-06 今日精选

📌 故事线更新

  🔴 欧盟 AI 法案 (Day 6)
     最新：首批三家公司被调查
     此前：法案生效 → 科技公司批评 → 今天执法开始
     → https://...

  🟡 OpenAI 组织架构变动 (Day 12)
     最新：任命新 CTO，前 CTO Mira 加入 Anthropic
     → https://...

🆕 今日新事件

  SpaceX 星舰第七次试飞成功回收
  → https://...

  [...]
```

### 存储格式

```jsonl
{"id":"arc-eu-ai-act","title":"欧盟 AI 法案","tags":["regulation","eu","ai"],"status":"active","firstSeen":"2026-02-15","lastUpdated":"2026-03-06","itemCount":4,"items":["item-abc","item-def","item-ghi","item-jkl"],"summary":"欧盟 AI Act 从审议到生效到首次执法的全过程"}
```

---

## 7. Feature 3：Source Tier 信源分级

### 问题

v1 的 `source.weight` 和 `source.reliability` 是可选的浮点数，没有标准化。实际使用中，几乎没人配。

### 方案

借鉴 WorldMonitor 的 4 级分类，但适配我们的场景：

| Tier | 定义 | 特征 | 权重 | 示例 |
|------|------|------|------|------|
| **T1** | 一手源 | 官方、通讯社、当事方 | 2.0× | Reuters, AP, 白宫, OpenAI Blog |
| **T2** | 权威媒体 | 主流媒体、深度报道 | 1.5× | BBC, NYT, 财新, The Verge |
| **T3** | 专业/垂类 | 行业媒体、技术博客 | 1.0× | Hacker News, 36氪, Defense One |
| **T4** | 聚合/社区 | 社交平台、论坛 | 0.7× | V2EX, X, 微博, Reddit |

### 在 source pack 中的表达

```yaml
# sources/us-tech.yaml
sources:
  - name: OpenAI Blog
    url: https://openai.com/news/rss.xml
    tier: 1          # 一手源
    tags: [ai, openai]

  - name: The Verge
    url: https://www.theverge.com/rss/index.xml
    tier: 2          # 权威媒体
    tags: [tech]

  - name: Hacker News
    url: https://hnrss.org/frontpage
    tier: 3          # 社区/聚合
    tags: [tech, dev]
```

### Tier 在排序中的作用

更新排序公式：

```js
score = (engagement_log + recency_boost)
      * tier_weight        // NEW: T1=2.0, T2=1.5, T3=1.0, T4=0.7
      * topic_match_boost
      * buzz_signal        // NEW: 见 Feature 4
```

### Tier 在 Story Arc 中的作用

当多个源报道同一事件时：

- T1 源的报道作为 Arc 的"权威描述"
- T4 源的讨论提供"社交热度"信号
- 同一事件被 T1+T2 同时报道 → 自动标记为 🔥

### Tier 在去重中的作用

当两条相似新闻来自不同 tier，保留更高 tier 的那条，把低 tier 的 engagement 数据合并过去。

---

## 8. Feature 4：Buzz Signal 谈资指数

### 问题

用户有一种很常见的需求："今天大家在聊什么？"这不是关于自己的兴趣，而是关于社交圈的共识。v1 完全不覆盖这个场景。

### 核心指标：Buzz Score

```
buzz_score = cross_source_factor     // 几个不同来源报道了同一事件
           + social_engagement       // X/V2EX/微博 的讨论热度
           + velocity                // 短时间内的增长速率
```

#### cross_source_factor

```
appeared_in = 去重后，同一事件出现在几个不同 source 的 items 中
factor = min(appeared_in / 3, 2.0)  // 3个源以上开始显著，cap 在 2x
```

这利用了我们多源聚合的天然优势——如果一个事件同时出现在 Reuters、Hacker News 和 V2EX，那它大概率是大事。

#### social_engagement

```
// 归一化到 0-1 区间（因为不同平台量级不同）
normalized = log1p(likes + 2*reposts + replies) / platform_max_log
```

#### velocity

```
// 某事件在过去 N 小时内的条目增长率
velocity = items_in_last_6h / max(items_in_prev_6h, 1)
```

velocity > 3 意味着事件在加速升温。

### Digest 中的呈现

```
🗣️ 今日谈资 TOP 3
1. 🔥🔥🔥 OpenAI 开源 GPT-5 权重（12 源报道，X 热搜 #3）
2. 🔥🔥   日本央行意外加息（8 源报道，市场剧烈波动）
3. 🔥     某明星离婚（微博热搜 #1，但你可能不关心）
```

注意第 3 条——buzz score 高但和用户 topic 不匹配。这类条目可以出现在"谈资"模块，但不会进入主 digest。这是一种**controlled serendipity**：让用户知道"大家在聊什么"，但不用强制阅读。

---

## 9. Feature 5：Serendipity 视野扩展

### 问题

纯 topic matching 的结果是**信息茧房**——用户只看到自己已经关注的东西，逐渐失去对更广阔世界的感知。这不是好的信息助手应该做的事。

### 方案

每期 digest 保留 1-2 个**serendipity slot**，给"用户不会主动搜索、但可能觉得有意思"的条目。

### 选择策略

```yaml
serendipity:
  enabled: true
  slots_per_digest: 1
  strategy: high_buzz_outside_topics   # 默认策略
  strategies:
    high_buzz_outside_topics:
      # 条件：buzz_score > 阈值 AND topic_match_score = 0
      min_buzz: 1.5
      exclude_topics: true             # 排除所有已配置 topic

    cross_language:
      # 推荐一条和用户语言偏好不同的高质量新闻
      # 中文用户看到英文好文推荐，反之亦然
      min_tier: 2
      opposite_language: true

    editorial_pick:
      # 从"编辑精选"类源中选（如 Longreads, The Atlantic, 看理想）
      source_tag: editorial
```

### 呈现

```
💡 意外发现
冰岛成为全球首个实现 100% 可再生能源供电的国家
→ 和你的关注领域无关，但 7 个国际源同时报道了这条
→ https://...
```

用明确的标签告诉用户"这条是视野扩展，不是你的 topic"——尊重用户的注意力，同时提供选择。

---

## 10. Feature 6：Context Injection 背景注入

### 问题

很多新闻用户看不懂，不是因为不识字，而是缺乏上下文。"欧盟 AI 法案首次执法"——如果用户不知道 AI Act 是什么、什么时候通过的、关键条款是什么，这条标题毫无价值。

### 方案

对 Daily / Deep 层级的输出，为每条新闻生成一句话背景：

```
📎 背景：2024年3月欧盟议会通过全球首个 AI 专项法规，
分阶段实施，2026年3月全面执行。关键条款包括禁止
社会信用评分和实时面部识别。
```

### 生成方式

**LLM 单次 batch 调用**：

```
System: 你是一个新闻背景注入器。对于每条新闻标题，
生成一句话(30字以内)的背景上下文，帮助读者理解
"为什么这件事重要"和"之前发生了什么"。
如果新闻本身就足够清晰，返回 null。

Items:
1. "欧盟 AI 法案首次执法"
2. "SpaceX 星舰第七次试飞"
3. "苹果发布新 MacBook"

Output JSON:
[
  {"id":1, "context":"2024年3月通过，全球首个 AI 专项法规，2026年3月全面执行"},
  {"id":2, "context":"此前六次试飞中两次成功回收助推器，本次首次尝试整体回收"},
  {"id":3, "context":null}
]
```

### 成本控制

- 只对 Daily（5-8 条）和 Deep（1-2 条）生成
- 一次 LLM 调用处理整个 batch
- Flash 不做 context injection（Level 0 用户不需要）
- 估计成本：每日 < $0.01（GPT-4o-mini 级别即可）

### 与 Story Arc 的协同

如果一条新闻属于某个 Story Arc，context injection 可以直接引用 Arc 的历史：

```
📎 故事线第 6 天：此前 2/28 法案生效 → 3/1 科技公司批评 → 今天首次执法
```

这比通用的背景更精准，因为基于用户实际跟踪过的信息。

---

## 11. Feature 7：Consumption Memory 消费记忆

### 问题

每天的 digest 都是"无记忆"的——不知道用户昨天看了什么、对什么感兴趣、什么被跳过了。

### 方案

记录用户的消费行为，用于三个目的：
1. **去重**：已经推过的不再推
2. **调权**：用户偏好的 topic 自动加权
3. **Arc 追踪**：用户关注过的 Arc 保持活跃更久

### 数据来源

| 信号 | 采集方式 | 可靠度 |
|------|---------|--------|
| 链接被点开 | iMessage/Telegram URL preview 回调 | 中 |
| 用户回复"详情" | 触发 Daily 版本 | 高 |
| 用户回复"继续追踪X" | 显式表达兴趣 | 最高 |
| 用户无任何互动 | 推送后 24h 无响应 | 低（可能只是忙） |

### 存储

```jsonl
// out/consumption-YYYY-MM-DD.jsonl
{"date":"2026-03-06","itemId":"item-abc","action":"delivered","tier":"daily"}
{"date":"2026-03-06","itemId":"item-abc","action":"clicked","at":"2026-03-06T09:15:00Z"}
{"date":"2026-03-06","itemId":"item-def","action":"delivered","tier":"daily"}
{"date":"2026-03-06","itemId":"item-def","action":"skipped"}
```

### 影响排序

```js
// 用户近 7 天的 topic 点击率
topicCTR = clickedItemsWithTag[topic] / deliveredItemsWithTag[topic]

// 加权
personalBoost = 1.0 + (topicCTR - 0.5) * 0.4
// 如果用户 70% 都点了 AI 相关 → boost 1.08
// 如果用户只有 20% 点了体育 → boost 0.88
```

### 隐式反馈 vs 显式反馈

v2 MVP 先做**隐式反馈**（点击/跳过），因为：
- 无需用户额外操作
- 数据量大
- 足够做基础调权

**显式反馈**（👍/👎 按钮）留到 Phase 3：
- 需要消息平台支持 inline button
- 数据更精准但量少
- 实现成本高

---

## 12. Feature 8：场景化推送

### 问题

v1 是"每天一次 cron，输出一份 digest"。但用户在不同时间需要的东西不一样。

### 方案

将推送策略和时间-模式矩阵对齐：

```
07:30  ⚡ Flash     → "世界还在吗？有大事吗？"
09:00  📰 Daily     → "今天值得知道的事"
12:30  🗣️ Buzz      → "大家在聊什么"（仅 buzz top 3，可选）
20:00  🔍 Deep      → "值得深度阅读的内容"
Sun    📊 Weekly    → "本周故事线回顾"
```

### Breaking Alert（可选扩展）

对特别重大的事件（buzz_score > 高阈值 + 多个 T1 源同时报道），可以在非计划时间发送一条推送：

```yaml
alerts:
  enabled: false     # 默认关闭，避免打扰
  min_buzz: 3.0
  min_tier1_sources: 2
  cooldown_hours: 4  # 两次 alert 间至少间隔 4 小时
  quiet_hours: "23:00-07:30"
```

```
🚨 突发：美联储紧急降息 50 基点
3 个 T1 源（Reuters, AP, Bloomberg）同时报道
→ https://...
```

### 实现

每个 output tier 对应一个独立的 cron 任务：

```bash
# crontab
30 7  * * *  node bin/digest --tier flash --deliver
0  9  * * *  node bin/digest --tier daily --deliver
0  20 * * *  node bin/digest --tier deep --deliver
0  10 * * 0  node bin/digest --tier weekly --deliver
```

或者在 OpenClaw 中配置 cron jobs，指向不同的 --tier 参数。

---

## 13. Schema 演进

### FeedItem v2

在 v1 基础上新增字段（向后兼容）：

```ts
type FeedItem = {
  // === v1 existing fields (unchanged) ===
  platform: Platform;
  sourceType: SourceType;
  id: string;
  url: string;
  title?: string;
  text?: string;
  author?: { name?: string; handle?: string };
  language?: string;
  publishedAt?: string;
  fetchedAt?: string;
  metrics?: { like?: number; repost?: number; reply?: number; quote?: number; view?: number };
  tags?: string[];
  score?: number;
  source?: { pack?: string; name?: string; weight?: number; reliability?: number };
  debug?: { tagHits?: Record<string, string[]> };
  raw?: unknown;

  // === v2 new fields ===

  /** Source Tier: 1=一手源, 2=权威媒体, 3=垂类专业, 4=聚合/社区 */
  tier?: 1 | 2 | 3 | 4;

  /** Buzz signal */
  buzz?: {
    crossSourceCount?: number;    // 几个不同来源报道了
    socialEngagement?: number;    // 归一化社交热度 0-1
    velocity?: number;            // 增长速率
    score?: number;               // 综合 buzz score
  };

  /** Story Arc 关联 */
  arc?: {
    id?: string;                  // 所属 Arc ID
    title?: string;               // Arc 标题
    position?: number;            // 在 Arc 中的时间位置（第几个 item）
    daysSinceStart?: number;      // Arc 开始至今天数
  };

  /** Context injection */
  context?: string;               // LLM 生成的一句话背景

  /** 消费记忆 */
  consumption?: {
    delivered?: boolean;
    deliveredAt?: string;
    clicked?: boolean;
    clickedAt?: string;
    tier?: string;                // 在哪个输出层级被推送的
  };
};
```

### StoryArc（新类型）

```ts
type ArcStatus = 'active' | 'dormant' | 'closed';

type StoryArc = {
  id: string;                     // 唯一标识，如 "arc-eu-ai-act-2026"
  title: string;                  // 故事线标题
  summary?: string;               // LLM 生成的一句话概要
  tags: string[];
  status: ArcStatus;
  firstSeen: string;              // ISO8601
  lastUpdated: string;            // ISO8601
  itemCount: number;
  items: string[];                // 关联的 FeedItem IDs
  entities: string[];             // 涉及的实体（公司、人名、国家）
  timeline?: {                    // 时间线摘要（用于 Weekly 渲染）
    date: string;
    headline: string;
  }[];
};
```

---

## 14. 架构演进

### v1 Pipeline

```
config → adapters → normalize → dedup → rank → render → output
```

### v2 Pipeline

```
config → adapters → normalize → enrich → dedup+cluster → arc_match
                                  │
                          ┌───────┴────────┐
                          │ tier assign    │
                          │ entity extract │
                          │ language detect│
                          └───────┬────────┘
                                  │
              → buzz_calc → rank → context_inject → serendipity_slot
                                                         │
                                            → multi_tier_render → deliver
                                                         │
                                            → consumption_log
```

### 新增模块

| 模块 | 文件 | 职责 |
|------|------|------|
| `enrich.js` | 新增 | Tier 标注、entity 提取、语言检测 |
| `buzz.js` | 新增 | 计算 cross-source factor、social engagement、velocity |
| `arc.js` | 新增 | Story Arc 匹配、创建、更新、生命周期管理 |
| `context.js` | 新增 | LLM 背景注入（batch 调用） |
| `serendipity.js` | 新增 | 视野扩展条目选择 |
| `consumption.js` | 新增 | 消费记忆读写 |
| `render.js` | **重构** | 从单一格式改为 Multi-tier renderer |
| `rank.js` | **扩展** | 集成 tier_weight、buzz_score、arc_weight |
| `deliver.js` | 新增 | 调度推送到不同 channel（可复用 OpenClaw Skill 机制） |

### 数据存储

```
out/
├── items-YYYY-MM-DD.jsonl        # 每日 items（v1 兼容 + v2 新字段）
├── arcs.jsonl                    # Story Arc 持久存储
├── consumption-YYYY-MM-DD.jsonl  # 消费记忆
├── digest-YYYY-MM-DD-flash.md   # Flash 输出
├── digest-YYYY-MM-DD-daily.md   # Daily 输出
├── digest-YYYY-MM-DD-deep.md    # Deep 输出
└── digest-YYYY-WW-weekly.md     # Weekly 输出
```

---

## 15. 配置设计

### 完整配置示例（feeds.yaml v2）

```yaml
# feeds.yaml v2 — Universal Feeds 配置

# ── 数据源 ──
sources:
  packs:
    - sources/us-general.yaml
    - sources/us-tech.yaml
    - sources/us-ai-labs.yaml
    - sources/cn-general.yaml
    - sources/cn-tech.yaml
    - sources/youtube-ai-channels.yaml

  # Google News meta-source（借鉴 WorldMonitor）
  google_news:
    enabled: true
    queries:
      - query: "site:reuters.com world"
        name: "Reuters World (GN)"
        tier: 1
        category: politics
      - query: "(OpenAI OR Anthropic OR Google AI) when:2d"
        name: "AI Labs News (GN)"
        tier: 2
        category: ai

# ── Topic 偏好 ──
topics:
  - name: ai-industry
    keywords: ["OpenAI", "Anthropic", "Claude", "GPT", "Gemini", "LLM"]
    boost: 2.0

  - name: apple
    keywords: ["Apple", "iPhone", "macOS", "WWDC", "Vision Pro"]
    exclude_keywords: ["apple juice", "apple pie"]
    boost: 1.5

  - name: china-tech
    keywords: ["字节", "腾讯", "阿里", "华为", "小米", "比亚迪"]
    boost: 1.3

# ── 排序 ──
ranking:
  tier_weights: { 1: 2.0, 2: 1.5, 3: 1.0, 4: 0.7 }
  buzz_weight: 1.2          # buzz_score 在排序中的乘数
  recency_hours: 24
  arc_active_boost: 1.3     # 活跃 Arc 的新进展加权

# ── 输出层级 ──
outputs:
  flash:
    enabled: true
    count: 8
    schedule: "07:30"
    channel: imessage

  daily:
    enabled: true
    count: 8
    format: title_with_why
    include_serendipity: true
    serendipity_slots: 1
    schedule: "09:00"
    channel: imessage

  deep:
    enabled: true
    count: 2
    format: long_summary_with_context
    include_context: true
    schedule: "20:00"
    channel: imessage

  weekly:
    enabled: true
    format: story_arc_summary
    max_arcs: 5
    schedule: "sun 10:00"
    channel: imessage

  buzz:
    enabled: false           # 可选：午间谈资
    count: 3
    schedule: "12:30"
    channel: imessage

# ── 谈资 ──
buzz:
  cross_source_threshold: 3
  velocity_window_hours: 6

# ── 故事线 ──
story_arcs:
  enabled: true
  match_threshold: 0.35      # entity/keyword overlap 阈值
  dormant_after_days: 7
  close_after_days: 30
  max_active_arcs: 20

# ── 视野扩展 ──
serendipity:
  enabled: true
  strategy: high_buzz_outside_topics
  min_buzz: 1.5

# ── 背景注入 ──
context_injection:
  enabled: true
  tiers: [daily, deep]       # 只对这些输出层级生成
  model: gpt-4o-mini          # 成本最优

# ── 消费记忆 ──
consumption_memory:
  enabled: true
  dedup_window_days: 3        # 3 天内推过的不再推
  learning_window_days: 7     # 用 7 天数据学习偏好

# ── Breaking Alert ──
alerts:
  enabled: false
  min_buzz: 3.0
  min_tier1_sources: 2
  cooldown_hours: 4
  quiet_hours: "23:00-07:30"

# ── 通用 ──
output:
  language: zh                # digest 输出语言
  max_items: 50               # 单次抓取的 items 上限
```

---

## 16. 实施路线图

### Phase 1：MVP 独立项目（6-8 周）

**目标**：从 OpenClaw Skill 升级为独立 Web 服务（详见技术架构文档）

- [ ] **Web 服务 + 账号系统**：Hono + React + better-auth，Docker Compose 一键部署
- [ ] **Feed 采集引擎**：RSS adapter（复用 v1）+ **Google News meta-source**（gn() helper）
- [ ] **Source Tier**：在 source 配置中标注 tier 1-4，影响排序权重
- [ ] **Multi-tier Digest**：Flash / Daily / Deep 三层渲染 + Web 阅读页
- [ ] **Topic 偏好配置**：Web UI 配置关键词 + 权重
- [ ] **Story Arc MVP**：entity + keyword overlap 聚类
- [ ] **Context Injection**：LLM batch 生成一句话背景
- [ ] **Dashboard**：最新 Digest + 活跃 Arc + 基础统计

**产出**：`docker compose up` 即可运行的完整 Web 信息助手

### Phase 2：智能化（4-6 周）

**目标**：加入更多 adapter 和 LLM 驱动的智能功能

- [ ] **更多 Adapter**：X (via bird)、V2EX、YouTube
- [ ] **Buzz Signal**：cross_source_factor + social_engagement + velocity
- [ ] **"为什么重要"**：Daily 层级的 LLM 生成
- [ ] **Arc Matcher v2**：模糊区域用 LLM 确认
- [ ] **Serendipity Slot**：视野扩展条目选择
- [ ] **Weekly 周报**：Story Arc 汇总 + 趋势
- [ ] **Email 推送**：Resend / SMTP
- [ ] **消费记忆**：记录推送/点击/跳过，个性化调权

**产出**：digest 从"列表"变成"有智能的信息服务"

### Phase 3：社交化（4-6 周）

**目标**：多渠道推送 + 用户反馈闭环

- [ ] **Telegram Bot 推送 + 回调**
- [ ] **显式反馈**：👍/👎 按钮
- [ ] **Arc 可视化增强**
- [ ] **用户可自定义添加 Source**
- [ ] **已推去重**：3 天内推过的不再出现

**产出**：完整的多渠道信息助手

### Phase 4：规模化（按需）

- [ ] **PostgreSQL 迁移**
- [ ] **开放注册 + OAuth**
- [ ] **Webhook 推送**
- [ ] **Telegram 频道源**（借鉴 WorldMonitor）
- [ ] **Embedding 相似度**：Arc Matcher v3
- [ ] **多语言支持**
- [ ] **移动端 PWA 优化**

---

## 17. 成功指标

### 功能指标

| 指标 | v1 现状 | v2 Phase 1 目标 | v2 Phase 3 目标 |
|------|--------|----------------|----------------|
| Digest 格式 | 1 种 | 3 种（flash/daily/deep） | 4 种（+weekly） |
| 数据源数量 | ~20 | ~40（+Google News） | ~60（+Telegram） |
| 故事线追踪 | 无 | MVP | 多策略匹配 |
| 背景上下文 | 无 | 无 | 每条附背景 |
| 谈资指数 | 无 | 无 | buzz top 3 |
| 视野扩展 | 无 | 无 | 每期 1 条 |

### 用户体验指标

| 指标 | 目标 | 衡量方式 |
|------|------|---------|
| Digest 相关率 | >80% 条目用户认为"值得知道" | 用户反馈 / 点击率 |
| 阅读时长匹配 | Flash <1min, Daily 3-5min | 条目数控制 |
| 故事线准确率 | >70% 的 Arc 分组用户认为合理 | 用户反馈 |
| 意外发现价值 | >50% 的 serendipity 条目用户觉得有意思 | 点击率 |
| 推送骚扰度 | 用户不觉得"太多了" | 无主动关闭行为 |

### 技术指标

| 指标 | 目标 |
|------|------|
| 单次 digest 生成时间 | < 90 秒 |
| LLM 调用成本（每日） | < $0.05 |
| Arc 匹配误报率 | < 20% |
| 数据源故障容忍 | 单源挂掉不影响整体 digest |

---

## 18. 风险与约束

### 技术风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM 调用成本失控 | 超预算 | 只对 top N 调用；用最便宜的模型；batch |
| Arc 匹配误分组 | 用户困惑 | 先用保守阈值；Phase 2 加 LLM 确认 |
| 数据源频繁变动 | adapter 维护成本 | 优先 RSS（最稳定）；Google News 做兜底 |
| 消费记忆隐私 | 用户担忧 | 纯本地存储；不上传任何数据 |

### 产品风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 功能太多反而复杂 | 用户配置负担 | 合理默认值；渐进式启用 |
| Serendipity 变成噪音 | 用户关闭功能 | 严格 buzz 阈值；每期只 1 条 |
| 场景化推送太频繁 | 用户厌烦 | 默认只开 flash + daily；buzz/alert 默认关 |

### 约束

- **Self-hosted**：所有计算和存储在用户本地
- **无 ML 训练**：个性化用规则 + 统计，不做模型训练
- **Privacy-first**：消费记忆不出本机
- **LLM 非必须**：所有 LLM 功能可关闭，退化为 v1 行为

---

## 19. 附录：竞品参考

### WorldMonitor (koala73/worldmonitor)

- **启发**：Source Tier、Google News meta-source、Category 分组、Variant 机制
- **不借鉴**：地图/可视化、实时流、桌面客户端
- **关键数据**：31.5k stars，435+ feeds，21 语言，TypeScript/Tauri

### 其他参考

| 产品 | 启发点 | 不适用 |
|------|--------|--------|
| **Artifact (by Perplexity)** | AI 摘要 + 多角度呈现 | SaaS 模式 |
| **Morning Brew** | "为什么重要"写法、conversational tone | 人工编辑 |
| **The Browser** | 编辑精选 serendipity | 付费订阅 |
| **Feedly AI** | 主题追踪、优先级 | 闭源 SaaS |
| **GDELT Project** | 事件 clustering、故事线 | 学术级复杂度 |

---

## 结语

Universal Feeds v1 回答了"如何聚合多源信息"。

v2 要回答的问题更有野心：**"如何像一个真正理解你的信息助手一样，在对的时间、以对的深度、给你对的信息——同时偶尔带来惊喜"**。

这不是一个技术升级，是一个产品理念的跃迁。

从"RSS 聚合器"到"智能信息助手"。

---

*文档版本：v2.0 Draft | 最后更新：2026-03-06*

# Milestone 2 — 采集 + Digest + 阅读：详细执行与验收计划

> **目标**：让 ArcLight 真正能抓取新闻、生成 Digest、在页面上阅读。  
> 覆盖：RSS 实际解析 → Feed 采集引擎 → User Preferences → Digest 生成 → 前端阅读。  
> Story Arc 留到 M3。
>
> **完成标志**：`npm run dev` → 登录 → Scheduler 自动抓取 → 26 个源全部有数据 → 手动触发 Digest 生成 → Dashboard 显示最新 Digest → 阅读页渲染完整 Digest（含 Context Injection）。

---

## 依赖关系总览

```
Phase A: RSS Adapter (串行)
  A1 → A2 → A3

Phase B: Feed 采集引擎 (依赖 A 完成)
  B1 → B2 → B3 → B4 → B5 → B6
  (B1-B3 串行；B5, B6 可与 B4 并行)

Phase C: User Preferences (与 B 并行)
  C1 → C2
  C1 → C3
  C4 独立

Phase D: Digest 引擎 (依赖 B4, C1 完成)
  D1 → D2 → D3
  D4 → D5 (与 D1-D3 并行)
  D6 (依赖 D3, D5)
  D7 (依赖 D3)
  D8 (依赖 D6)

Phase E: 前端 Digest 阅读 (依赖 D7 完成)
  E1 → E2 (串行)
  E3 (依赖 D7)
  E4 (依赖 E1, E3)
```

```
  A1─A2─A3
         │
    ┌────┴────────────────┐
    B1─B2─B3─B4          C1─┬─C2
    │        │  ↘         │  └─C3
    B5       B6  ↘        │   C4
                  ↘       │
              D1─D2─D3  D4─D5
                    │      │
                    D6─────┘
                    │  D7
                    D8  │
                     ┌──┘
                  E1─E2
                  E3
                  E4
```

**可并行的组**：
- **Phase B** 和 **Phase C** 可以完全并行（两个 coder 可分工）
- **D4-D5**（LLM Client）和 **D1-D3**（Pipeline + Ranking + Renderer）可并行
- **E1-E2** 和 **E3** 可并行

---

## 预装依赖

以下依赖需要在开始前安装到 `packages/backend`：

```bash
cd ~/projects/arclight
npm install -w packages/backend fast-xml-parser franc-min
```

> **fast-xml-parser**：轻量 XML 解析器，零依赖，支持 RSS 2.0 / Atom / RDF。
> **franc-min**：轻量语言检测（~200KB，仅常见语言）。

**已有但需确认的包**：`p-limit`（并发控制）、`node-cron`（定时任务）、`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic`（LLM）— 均已在 package.json 中。

前端无需额外安装包（shadcn/ui 组件按需 `npx shadcn@latest add` 即可）。

---

## Phase A — RSS Adapter 实现

### A1. fast-xml-parser 实现 RSS 2.0 解析

**依赖**：无  
**目标**：`RssAdapter.parseRss()` 能正确解析 RSS 2.0 格式的 XML，返回 `RawFeedItem[]`。

**操作步骤**：

1. 编辑 `packages/backend/src/engine/adapters/rss.ts`，替换整个文件：

```typescript
// packages/backend/src/engine/adapters/rss.ts
import { XMLParser } from 'fast-xml-parser';
import type { FeedAdapter, RawFeedItem, FetchOptions } from '@arclight/shared';
import { logger } from '../../shared/logger.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => {
    // 这些字段始终当作数组处理，避免单条目时变成 object
    return ['item', 'entry', 'link', 'category'].includes(name);
  },
  parseTagValue: true,
  trimValues: true,
});

export class RssAdapter implements FeedAdapter {
  type = 'rss';

  supports(source: { type: string }): boolean {
    return source.type === 'rss' || source.type === 'atom';
  }

  async fetch(
    source: { url: string; name: string; type: string; fetchConfig?: Record<string, unknown> },
    options: FetchOptions,
  ): Promise<RawFeedItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout);

    try {
      const resp = await fetch(source.url, {
        headers: {
          'User-Agent': 'ArcLight/1.0 (+https://github.com/nicepkg/arclight)',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} from ${source.name}`);
      }

      const xml = await resp.text();
      const items = this.parse(xml, source.name);

      // 限制返回条数
      return items.slice(0, options.maxItems);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 解析 XML 字符串，自动识别 RSS 2.0 / Atom 格式
   */
  parse(xml: string, sourceName: string): RawFeedItem[] {
    try {
      const parsed = xmlParser.parse(xml);

      // RSS 2.0: rss > channel > item[]
      if (parsed.rss?.channel) {
        return this.parseRss2(parsed.rss.channel, sourceName);
      }

      // Atom: feed > entry[]
      if (parsed.feed?.entry) {
        return this.parseAtom(parsed.feed, sourceName);
      }

      // RDF/RSS 1.0: rdf:RDF > item[]
      if (parsed['rdf:RDF']?.item) {
        return this.parseRss2({ item: parsed['rdf:RDF'].item }, sourceName);
      }

      logger.warn({ sourceName }, 'Unknown feed format, no items found');
      return [];
    } catch (err) {
      logger.error({ sourceName, error: err }, 'XML parse error');
      return [];
    }
  }

  // ── RSS 2.0 ──

  private parseRss2(channel: any, sourceName: string): RawFeedItem[] {
    const items: any[] = channel.item || [];
    return items.map((item) => this.mapRss2Item(item, sourceName)).filter(Boolean) as RawFeedItem[];
  }

  private mapRss2Item(item: any, sourceName: string): RawFeedItem | null {
    const url = item.link || item.guid?.['#text'] || item.guid;
    if (!url || typeof url !== 'string') return null;

    const title = this.cleanHtml(item.title);
    const content = this.cleanHtml(item.description || item['content:encoded'] || '');
    const author = item['dc:creator'] || item.author;
    const pubDate = item.pubDate || item['dc:date'];

    return {
      externalId: (item.guid?.['#text'] || item.guid || url) as string,
      url: url.trim(),
      title: title || undefined,
      content: content || undefined,
      author: author ? { name: String(author) } : undefined,
      publishedAt: pubDate ? this.parseDate(pubDate) : undefined,
    };
  }

  // ── Atom ──

  private parseAtom(feed: any, sourceName: string): RawFeedItem[] {
    const entries: any[] = feed.entry || [];
    return entries.map((entry) => this.mapAtomEntry(entry, sourceName)).filter(Boolean) as RawFeedItem[];
  }

  private mapAtomEntry(entry: any, sourceName: string): RawFeedItem | null {
    // Atom link 可以是数组或单对象
    const links: any[] = Array.isArray(entry.link) ? entry.link : [entry.link].filter(Boolean);
    const altLink = links.find((l) => l?.['@_rel'] === 'alternate') || links[0];
    const url = altLink?.['@_href'] || altLink;
    if (!url || typeof url !== 'string') return null;

    const title = this.cleanHtml(
      typeof entry.title === 'object' ? entry.title['#text'] : entry.title,
    );

    const content = this.cleanHtml(
      entry.content?.['#text'] || entry.content || entry.summary?.['#text'] || entry.summary || '',
    );

    const author = entry.author?.name || entry.author;

    return {
      externalId: (entry.id || url) as string,
      url: url.trim(),
      title: title || undefined,
      content: typeof content === 'string' ? content : undefined,
      author: author ? { name: String(author) } : undefined,
      publishedAt: entry.published || entry.updated ? this.parseDate(entry.published || entry.updated) : undefined,
    };
  }

  // ── Helpers ──

  private parseDate(dateStr: string | number): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(String(dateStr));
    return isNaN(d.getTime()) ? undefined : d;
  }

  private cleanHtml(text: unknown): string {
    if (!text) return '';
    return String(text)
      .replace(/<[^>]*>/g, '')    // 去 HTML 标签
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
  }
}
```

**验收**：
```bash
# 写一个快速测试脚本验证解析
cd ~/projects/arclight
npx tsx -e "
const { RssAdapter } = await import('./packages/backend/src/engine/adapters/rss.js');
const adapter = new RssAdapter();

// 测试 RSS 2.0
const rss2 = \`<?xml version=\"1.0\"?>
<rss version=\"2.0\">
<channel><title>Test</title>
<item><title>Hello World</title><link>https://example.com/1</link><pubDate>Fri, 06 Mar 2026 12:00:00 GMT</pubDate></item>
<item><title>Second</title><link>https://example.com/2</link></item>
</channel></rss>\`;
const items = adapter.parse(rss2, 'test');
console.log('RSS 2.0 items:', items.length);       // 预期: 2
console.log('First title:', items[0].title);         // 预期: Hello World
console.log('First URL:', items[0].url);             // 预期: https://example.com/1
console.log('Has publishedAt:', !!items[0].publishedAt);  // 预期: true

// 测试 Atom
const atom = \`<?xml version=\"1.0\"?>
<feed xmlns=\"http://www.w3.org/2005/Atom\">
<title>Test Atom</title>
<entry><title>Atom Entry</title><link href=\"https://example.com/atom/1\" rel=\"alternate\"/><id>urn:1</id><published>2026-03-06T12:00:00Z</published></entry>
</feed>\`;
const atomItems = adapter.parse(atom, 'test-atom');
console.log('Atom items:', atomItems.length);        // 预期: 1
console.log('Atom title:', atomItems[0].title);       // 预期: Atom Entry
"
# 全部通过则 A1 完成
```

---

### A2. Atom 格式特殊处理完善

**依赖**：A1  
**目标**：确保真实世界的 Atom feed（如 GitHub releases、个人博客）解析正确。

**操作步骤**：

A1 的代码已包含 Atom 解析。此任务重点是**真实数据验证**。

1. 用真实 feed URL 做 end-to-end 测试：

```bash
cd ~/projects/arclight
npx tsx -e "
const { RssAdapter } = await import('./packages/backend/src/engine/adapters/rss.js');
const adapter = new RssAdapter();

// 测试几个真实的 RSS/Atom feed
const feeds = [
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage', type: 'rss' },
  { name: 'TechCrunch',  url: 'https://techcrunch.com/feed/', type: 'rss' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', type: 'rss' },
];

for (const feed of feeds) {
  try {
    const items = await adapter.fetch(
      { url: feed.url, name: feed.name, type: feed.type },
      { maxItems: 5, timeout: 15000 },
    );
    console.log(feed.name + ': ' + items.length + ' items');
    if (items[0]) {
      console.log('  → ' + (items[0].title || '(no title)').slice(0, 60));
      console.log('  → ' + items[0].url);
    }
  } catch (e) {
    console.error(feed.name + ' FAILED:', e.message);
  }
}
"
```

2. 如果发现解析问题，修复 `parseAtom` 或 `parseRss2` 中的 edge case。常见问题：
   - Atom `<link>` 没有 `rel="alternate"` 属性（直接取 `href`）
   - RSS `<guid>` 是纯文本不带 `isPermaLink` 属性
   - CDATA 包裹的 `<content:encoded>`
   - 日期格式非标准（`fast-xml-parser` 不会自动解析日期）

**验收**：
```bash
# 3 个真实 feed 全部返回 ≥1 条 item，且 title/url 有效
# 控制台输出类似：
# Hacker News: 5 items
#   → Show HN: ...
#   → https://...
# TechCrunch: 5 items
#   → ...
# Ars Technica: 5 items
#   → ...
```

---

### A3. Google News Adapter 验证

**依赖**：A2  
**目标**：确认 `GoogleNewsAdapter` 能通过 RSS adapter 复用正确抓取 Google News 结果。

**操作步骤**：

`GoogleNewsAdapter` 已有完整的 delegation 逻辑（调用 `RssAdapter.fetch`）。A1 中 RSS 解析实现后，Google News 应该自动可用。此任务只需验证。

```bash
cd ~/projects/arclight
npx tsx -e "
const { GoogleNewsAdapter, gn } = await import('./packages/backend/src/engine/adapters/google-news.js');
const adapter = new GoogleNewsAdapter();

// 测试 1: 通过 gn() 构建 URL
const url = gn('OpenAI OR Anthropic', { hl: 'en-US' });
console.log('URL:', url);  
// 预期: https://news.google.com/rss/search?q=OpenAI%20OR%20Anthropic&hl=en-US&gl=US&ceid=US:en

// 测试 2: 实际抓取
const items = await adapter.fetch(
  { url: '', name: 'AI News', type: 'google-news', fetchConfig: { query: 'OpenAI OR Anthropic' } },
  { maxItems: 5, timeout: 15000 },
);
console.log('Items:', items.length);
if (items[0]) {
  console.log('  → ' + (items[0].title || '(no title)').slice(0, 80));
  console.log('  → ' + items[0].url);
}
"
```

> ⚠️ 注意：Google News 在某些网络环境下可能被墙。如果超时，不阻塞后续任务，标记为"需 VPN 环境验证"。

**验收**：
```bash
# gn() URL 格式正确
# 抓取返回 ≥1 条 item（网络通畅时）
# 或确认网络不通时有正确的 error 信息（不崩溃）
```

---

## Phase B — Feed 采集引擎

### B1. Fetch Manager（并发控制 + 重试 + 超时）

**依赖**：A3  
**目标**：实现 `FetchManager` 类，管理多源并发抓取、指数退避重试、超时控制。

**操作步骤**：

1. 创建 `packages/backend/src/engine/fetch-manager.ts`：

```typescript
// packages/backend/src/engine/fetch-manager.ts
import pLimit from 'p-limit';
import { createAdapterRegistry } from './adapters/index.js';
import type { FeedAdapter, RawFeedItem, FetchOptions } from '@arclight/shared';
import { logger } from '../shared/logger.js';

export interface FetchSource {
  id: string;
  url: string;
  name: string;
  type: string;
  tier: number;
  fetchConfig?: Record<string, unknown>;
}

export interface FetchResult {
  source: FetchSource;
  items: RawFeedItem[];
  status: 'ok' | 'error';
  error?: string;
  durationMs: number;
}

export interface FetchManagerOptions {
  concurrency?: number;      // 默认 5
  maxRetries?: number;       // 默认 3
  defaultTimeout?: number;   // 默认 30000 (30s)
  defaultMaxItems?: number;  // 默认 50
}

export class FetchManager {
  private adapters: FeedAdapter[];
  private limit: ReturnType<typeof pLimit>;
  private maxRetries: number;
  private defaultTimeout: number;
  private defaultMaxItems: number;

  constructor(options: FetchManagerOptions = {}) {
    this.adapters = createAdapterRegistry();
    this.limit = pLimit(options.concurrency ?? 5);
    this.maxRetries = options.maxRetries ?? 3;
    this.defaultTimeout = options.defaultTimeout ?? 30_000;
    this.defaultMaxItems = options.defaultMaxItems ?? 50;
  }

  /**
   * 批量抓取多个源
   */
  async fetchBatch(sources: FetchSource[]): Promise<FetchResult[]> {
    const results = await Promise.allSettled(
      sources.map((source) =>
        this.limit(() => this.fetchWithRetry(source)),
      ),
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        source: sources[i],
        items: [],
        status: 'error' as const,
        error: result.reason?.message || 'Unknown error',
        durationMs: 0,
      };
    });
  }

  /**
   * 单源抓取 + 指数退避重试
   */
  private async fetchWithRetry(source: FetchSource): Promise<FetchResult> {
    const adapter = this.findAdapter(source);
    if (!adapter) {
      return {
        source,
        items: [],
        status: 'error',
        error: `No adapter for type: ${source.type}`,
        durationMs: 0,
      };
    }

    const fetchOptions: FetchOptions = {
      maxItems: (source.fetchConfig?.maxItems as number) ?? this.defaultMaxItems,
      timeout: (source.fetchConfig?.timeout as number) ?? this.defaultTimeout,
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const start = Date.now();
      try {
        const items = await adapter.fetch(source, fetchOptions);
        const durationMs = Date.now() - start;
        logger.info({ source: source.name, items: items.length, durationMs }, 'Fetch success');
        return { source, items, status: 'ok', durationMs };
      } catch (err: any) {
        const durationMs = Date.now() - start;
        if (attempt === this.maxRetries) {
          logger.error({ source: source.name, attempt, error: err.message, durationMs }, 'Fetch failed (final)');
          return {
            source,
            items: [],
            status: 'error',
            error: err.message,
            durationMs,
          };
        }
        // exponential backoff: 1s, 2s, 4s
        const delay = 1000 * Math.pow(2, attempt - 1);
        logger.warn({ source: source.name, attempt, delay, error: err.message }, 'Fetch retry');
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // unreachable, but TS needs it
    return { source, items: [], status: 'error', error: 'Exhausted retries', durationMs: 0 };
  }

  private findAdapter(source: FetchSource): FeedAdapter | undefined {
    return this.adapters.find((a) => a.supports({ type: source.type, url: source.url }));
  }
}
```

**验收**：
```bash
cd ~/projects/arclight
npx tsx -e "
const { FetchManager } = await import('./packages/backend/src/engine/fetch-manager.js');
const fm = new FetchManager({ concurrency: 2 });

const results = await fm.fetchBatch([
  { id: '1', url: 'https://hnrss.org/frontpage', name: 'HN', type: 'rss', tier: 3 },
  { id: '2', url: 'https://techcrunch.com/feed/', name: 'TC', type: 'rss', tier: 2 },
  { id: '3', url: 'https://invalid.example.com/feed', name: 'Bad', type: 'rss', tier: 3 },
]);

for (const r of results) {
  console.log(r.source.name + ': ' + r.status + ' (' + r.items.length + ' items, ' + r.durationMs + 'ms)');
}
// 预期:
// HN: ok (N items, Xms)
// TC: ok (N items, Xms)
// Bad: error (0 items, Xms)
"
```

---

### B2. Normalizer（统一 FeedItem 格式 + tier 继承 + entity 提取 + 语言检测）

**依赖**：B1  
**目标**：将 `RawFeedItem[]` 转换为可入库的 `NormalizedItem[]`，含 tier 继承、entity 提取、语言检测。

**操作步骤**：

1. 创建 `packages/backend/src/engine/normalizer.ts`：

```typescript
// packages/backend/src/engine/normalizer.ts
import { nanoid } from 'nanoid';
import type { RawFeedItem } from '@arclight/shared';
import type { FetchSource } from './fetch-manager.js';

export interface NormalizedItem {
  id: string;
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  content: string;
  author: { name?: string; handle?: string; avatarUrl?: string } | null;
  language: string | null;
  tier: number;
  publishedAt: Date | null;
  fetchedAt: Date;
  entities: string[];
  tags: string[];
  dedupHash: string;
}

/**
 * 已知公司/组织名。后续可从 DB 动态加载。
 * 作为 MVP 阶段的 "known entities" 列表。
 */
const KNOWN_ENTITIES: string[] = [
  'OpenAI', 'Anthropic', 'Google', 'Apple', 'Microsoft', 'Meta', 'Amazon', 'Tesla',
  'NVIDIA', 'SpaceX', 'DeepMind', 'Mistral', 'xAI', 'ByteDance', 'Tencent', 'Alibaba',
  'Samsung', 'Intel', 'AMD', 'Qualcomm', 'ARM', 'TSMC',
  'EU', 'FDA', 'SEC', 'FTC', 'WHO', 'NATO', 'UN',
  'China', 'US', 'Japan', 'India', 'Russia', 'Ukraine',
  'GPT', 'Claude', 'Gemini', 'Llama', 'ChatGPT', 'Copilot',
  'iPhone', 'Android', 'Bitcoin', 'Ethereum',
];

/**
 * 将 RawFeedItem[] 转换为 NormalizedItem[]
 */
export function normalize(
  rawItems: RawFeedItem[],
  source: FetchSource,
  fetchedAt: Date = new Date(),
): NormalizedItem[] {
  return rawItems
    .map((raw) => normalizeOne(raw, source, fetchedAt))
    .filter(Boolean) as NormalizedItem[];
}

function normalizeOne(
  raw: RawFeedItem,
  source: FetchSource,
  fetchedAt: Date,
): NormalizedItem | null {
  const url = raw.url?.trim();
  if (!url) return null;

  const title = (raw.title || '').trim();
  const content = (raw.content || '').trim();

  // 跳过无 title 且无 content 的垃圾条目
  if (!title && !content) return null;

  const textForAnalysis = `${title} ${content}`;

  return {
    id: nanoid(),
    sourceId: source.id,
    externalId: raw.externalId || url,
    url,
    title,
    content: content.slice(0, 5000), // 限制内容长度
    author: raw.author ? { name: raw.author.name, handle: raw.author.handle } : null,
    language: detectLanguage(textForAnalysis),
    tier: source.tier,               // 继承 source 的 tier
    publishedAt: raw.publishedAt || null,
    fetchedAt,
    entities: extractEntities(textForAnalysis),
    tags: source.fetchConfig?.tags as string[] || [],
    dedupHash: computeDedupHash(url, title),
  };
}

/**
 * 语言检测：使用 franc-min
 * 降级策略：franc 无法识别时返回 null
 */
function detectLanguage(text: string): string | null {
  if (!text || text.length < 20) return null;
  try {
    // franc-min 是 ESM，动态导入
    // 注意：此函数同步调用，需要在模块顶部初始化
    // MVP 阶段使用简单启发式
    return detectLanguageHeuristic(text);
  } catch {
    return null;
  }
}

/**
 * 简单语言检测启发式（MVP）
 * 通过 Unicode 字符范围判断
 */
function detectLanguageHeuristic(text: string): string | null {
  // 统计字符类型
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0;
  const japanese = text.match(/[\u3040-\u309f\u30a0-\u30ff]/g)?.length || 0;
  const korean = text.match(/[\uac00-\ud7af]/g)?.length || 0;
  const total = text.length;

  if (cjk / total > 0.1 && japanese === 0) return 'zh';
  if (japanese > 0) return 'ja';
  if (korean > 0) return 'ko';
  return 'en'; // 默认英文
}

/**
 * Entity 提取：规则匹配已知实体
 */
function extractEntities(text: string): string[] {
  const found = new Set<string>();

  for (const entity of KNOWN_ENTITIES) {
    // 大小写不敏感匹配，要求词边界
    const regex = new RegExp(`\\b${escapeRegExp(entity)}\\b`, 'i');
    if (regex.test(text)) {
      found.add(entity);
    }
  }

  // 额外：提取大写单词组（2+ words, 可能是专有名词）
  const capsMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  for (const m of capsMatches) {
    if (m.split(' ').length <= 4 && m.length > 5) {
      found.add(m);
    }
  }

  return [...found];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 计算去重 hash：基于 URL + 标题
 */
function computeDedupHash(url: string, title: string): string {
  // 简单的字符串 hash（FNV-1a 变体）
  const str = `${normalizeUrl(url)}|${title.toLowerCase().trim()}`;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // 去掉 tracking 参数
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    u.searchParams.delete('utm_content');
    u.searchParams.delete('utm_term');
    return u.href;
  } catch {
    return url;
  }
}
```

**验收**：
```bash
cd ~/projects/arclight
npx tsx -e "
const { normalize } = await import('./packages/backend/src/engine/normalizer.js');

const source = { id: 's1', url: 'https://example.com/feed', name: 'Test', type: 'rss', tier: 2 };
const rawItems = [
  { externalId: '1', url: 'https://example.com/openai-gpt5', title: 'OpenAI releases GPT-5 model', content: 'Anthropic responds...', publishedAt: new Date() },
  { externalId: '2', url: 'https://example.com/weather', title: '今天天气很好', content: '北京市今日晴朗' },
  { externalId: '3', url: '', title: 'No URL', content: '' },  // 应被过滤
];

const items = normalize(rawItems, source);
console.log('Normalized count:', items.length);        // 预期: 2（第 3 条被过滤）
console.log('Item 1 tier:', items[0].tier);             // 预期: 2（继承 source）
console.log('Item 1 entities:', items[0].entities);     // 预期: 包含 OpenAI, Anthropic
console.log('Item 1 lang:', items[0].language);         // 预期: en
console.log('Item 2 lang:', items[1].language);         // 预期: zh
console.log('Item 1 dedupHash:', items[0].dedupHash);  // 预期: 非空字符串
console.log('Has id:', !!items[0].id);                  // 预期: true (nanoid)
"
```

---

### B3. Dedup Engine（URL hash + 标题相似度）

**依赖**：B2  
**目标**：对 NormalizedItem[] 做去重，基于 dedupHash（URL+标题 hash）+ 标题相似度。

**操作步骤**：

1. 创建 `packages/backend/src/engine/dedup.ts`：

```typescript
// packages/backend/src/engine/dedup.ts
import type { NormalizedItem } from './normalizer.js';
import { logger } from '../shared/logger.js';

/**
 * 去重引擎：
 * 1. 完全匹配：dedupHash 相同 → 保留更高 tier 的
 * 2. 模糊匹配：标题相似度 > 阈值 → 聚类
 */
export function dedup(
  items: NormalizedItem[],
  options: { similarityThreshold?: number } = {},
): NormalizedItem[] {
  const threshold = options.similarityThreshold ?? 0.7;

  // Phase 1: exact dedup by hash
  const hashMap = new Map<string, NormalizedItem>();
  for (const item of items) {
    const existing = hashMap.get(item.dedupHash);
    if (!existing || item.tier < existing.tier) {
      // 保留更高 tier（数字更小 = tier 更高）
      hashMap.set(item.dedupHash, item);
    }
  }

  const uniqueByHash = [...hashMap.values()];

  // Phase 2: fuzzy dedup by title similarity
  const result: NormalizedItem[] = [];
  const clustered = new Set<string>();

  for (let i = 0; i < uniqueByHash.length; i++) {
    if (clustered.has(uniqueByHash[i].id)) continue;

    const current = uniqueByHash[i];
    result.push(current);

    // 检查后续 items 是否与当前相似
    for (let j = i + 1; j < uniqueByHash.length; j++) {
      if (clustered.has(uniqueByHash[j].id)) continue;

      const sim = titleSimilarity(current.title, uniqueByHash[j].title);
      if (sim >= threshold) {
        clustered.add(uniqueByHash[j].id);
        logger.debug(
          { kept: current.title.slice(0, 40), dropped: uniqueByHash[j].title.slice(0, 40), sim },
          'Dedup: fuzzy match',
        );
      }
    }
  }

  logger.info({ before: items.length, afterHash: uniqueByHash.length, afterFuzzy: result.length }, 'Dedup complete');
  return result;
}

/**
 * 已知 dedupHash 集合查重：用于增量写入 DB 前检查
 */
export function filterExisting(
  items: NormalizedItem[],
  existingHashes: Set<string>,
): NormalizedItem[] {
  return items.filter((item) => !existingHashes.has(item.dedupHash));
}

/**
 * 标题相似度：基于 bigram 的 Dice coefficient
 * 简单、快速、对标题级短文本效果好
 */
function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const aNorm = a.toLowerCase().trim();
  const bNorm = b.toLowerCase().trim();

  if (aNorm === bNorm) return 1;

  const aBigrams = getBigrams(aNorm);
  const bBigrams = getBigrams(bNorm);

  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let intersection = 0;
  for (const bigram of aBigrams) {
    if (bBigrams.has(bigram)) intersection++;
  }

  return (2 * intersection) / (aBigrams.size + bBigrams.size);
}

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

// 导出 titleSimilarity 用于测试
export { titleSimilarity };
```

**验收**：
```bash
cd ~/projects/arclight
npx tsx -e "
const { dedup, titleSimilarity } = await import('./packages/backend/src/engine/dedup.js');

// 测试相似度
console.log('Same:', titleSimilarity('OpenAI releases GPT-5', 'OpenAI releases GPT-5'));  // 预期: 1.0
console.log('Similar:', titleSimilarity('OpenAI releases GPT-5 model', 'OpenAI launches GPT-5'));  // 预期: >0.5
console.log('Different:', titleSimilarity('OpenAI releases GPT-5', 'Apple launches iPhone 17'));  // 预期: <0.3

// 测试去重
const items = [
  { id: '1', dedupHash: 'abc', title: 'OpenAI releases GPT-5', tier: 2, sourceId: 's1', url: 'u1', externalId: 'e1', content: '', author: null, language: 'en', publishedAt: null, fetchedAt: new Date(), entities: [], tags: [] },
  { id: '2', dedupHash: 'abc', title: 'OpenAI releases GPT-5', tier: 1, sourceId: 's2', url: 'u2', externalId: 'e2', content: '', author: null, language: 'en', publishedAt: null, fetchedAt: new Date(), entities: [], tags: [] },
  { id: '3', dedupHash: 'def', title: 'Apple launches iPhone 17', tier: 3, sourceId: 's3', url: 'u3', externalId: 'e3', content: '', author: null, language: 'en', publishedAt: null, fetchedAt: new Date(), entities: [], tags: [] },
];
const result = dedup(items);
console.log('Dedup result count:', result.length);  // 预期: 2
console.log('Kept tier:', result[0].tier);           // 预期: 1（保留更高 tier）
"
```

---

### B4. 抓取结果写入 DB

**依赖**：B3  
**目标**：将去重后的 NormalizedItem 写入 `feed_items` 表，并更新 `feed_sources` 的抓取状态。

**操作步骤**：

1. 创建 `packages/backend/src/engine/store.ts`：

```typescript
// packages/backend/src/engine/store.ts
import { db } from '../db/client.js';
import { feedItems, feedSources } from '../db/schema.js';
import { eq, inArray, sql } from 'drizzle-orm';
import type { NormalizedItem } from './normalizer.js';
import type { FetchResult } from './fetch-manager.js';
import { logger } from '../shared/logger.js';

/**
 * 写入新的 feed items 到数据库
 * 先查询已有的 dedupHash，跳过已存在的
 */
export async function storeItems(items: NormalizedItem[]): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };

  // 查询已有的 dedup hash
  const hashes = items.map((i) => i.dedupHash);
  const existing = await db
    .select({ hash: feedItems.dedupHash })
    .from(feedItems)
    .where(inArray(feedItems.dedupHash, hashes));

  const existingSet = new Set(existing.map((e) => e.hash));
  const newItems = items.filter((i) => !existingSet.has(i.dedupHash));

  if (newItems.length === 0) {
    return { inserted: 0, skipped: items.length };
  }

  // 批量插入（SQLite 单次 INSERT 有变量限制，分批处理）
  const BATCH_SIZE = 50;
  let inserted = 0;

  for (let i = 0; i < newItems.length; i += BATCH_SIZE) {
    const batch = newItems.slice(i, i + BATCH_SIZE);
    await db.insert(feedItems).values(
      batch.map((item) => ({
        id: item.id,
        sourceId: item.sourceId,
        externalId: item.externalId,
        url: item.url,
        title: item.title,
        content: item.content,
        author: item.author,
        language: item.language,
        tier: item.tier,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        entities: item.entities,
        tags: item.tags,
        dedupHash: item.dedupHash,
        createdAt: new Date(),
      })),
    );
    inserted += batch.length;
  }

  logger.info({ inserted, skipped: items.length - newItems.length }, 'Items stored');
  return { inserted, skipped: items.length - newItems.length };
}

/**
 * 更新 source 抓取状态
 */
export async function updateSourceStatus(
  result: FetchResult,
): Promise<void> {
  if (result.status === 'ok') {
    await db
      .update(feedSources)
      .set({
        lastFetchedAt: new Date(),
        lastFetchStatus: 'ok',
        fetchErrorCount: 0,
      })
      .where(eq(feedSources.id, result.source.id));
  } else {
    await db
      .update(feedSources)
      .set({
        lastFetchStatus: 'error',
        fetchErrorCount: sql`${feedSources.fetchErrorCount} + 1`,
      })
      .where(eq(feedSources.id, result.source.id));
  }
}

/**
 * 获取所有已有的 dedup hash（用于批量查重）
 * 限制最近 N 天的 hash 避免全表扫描
 */
export async function getRecentDedupHashes(days: number = 7): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ hash: feedItems.dedupHash })
    .from(feedItems)
    .where(sql`${feedItems.fetchedAt} > ${since}`);

  return new Set(rows.map((r) => r.hash).filter(Boolean) as string[]);
}
```

**验收**：
```bash
cd ~/projects/arclight
# 确保 DB 已 migrate
npm run db:migrate

npx tsx -e "
const { storeItems, updateSourceStatus } = await import('./packages/backend/src/engine/store.js');
const { normalize } = await import('./packages/backend/src/engine/normalizer.js');
const { db } = await import('./packages/backend/src/db/client.js');
const { feedItems } = await import('./packages/backend/src/db/schema.js');
const { count } = await import('drizzle-orm');

const source = { id: 'test-src-1', url: 'https://example.com', name: 'Test', type: 'rss', tier: 2 };
const normalized = normalize(
  [{ externalId: 'e1', url: 'https://example.com/test-b4', title: 'Test B4 Item', publishedAt: new Date() }],
  source,
);

const result = await storeItems(normalized);
console.log('Insert result:', result);  // 预期: { inserted: 1, skipped: 0 }

// 再次插入应跳过
const result2 = await storeItems(normalized);
console.log('Duplicate result:', result2);  // 预期: { inserted: 0, skipped: 1 }

// 查询确认
const [{ value: total }] = await db.select({ value: count() }).from(feedItems);
console.log('Total items in DB:', total);  // 预期: >= 1
"
```

---

### B5. Scheduler（node-cron 定时抓取）

**依赖**：B4  
**目标**：实现 cron 调度器，按 source tier 不同间隔自动抓取。

**操作步骤**：

1. 创建 `packages/backend/src/engine/scheduler.ts`：

```typescript
// packages/backend/src/engine/scheduler.ts
import cron from 'node-cron';
import { db } from '../db/client.js';
import { feedSources } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { FetchManager, type FetchSource } from './fetch-manager.js';
import { normalize } from './normalizer.js';
import { dedup } from './dedup.js';
import { storeItems, updateSourceStatus } from './store.js';
import { logger } from '../shared/logger.js';

const CIRCUIT_BREAKER_THRESHOLD = 10;

/**
 * 默认抓取间隔（分钟），按 tier 区分
 */
const DEFAULT_INTERVALS: Record<number, number> = {
  1: 15,   // T1 通讯社: 15 分钟
  2: 30,   // T2 主流媒体: 30 分钟
  3: 60,   // T3 行业博客: 60 分钟
  4: 30,   // T4 社区: 30 分钟
};

export class FeedScheduler {
  private fetchManager: FetchManager;
  private tasks: cron.ScheduledTask[] = [];
  private running = false;

  constructor() {
    this.fetchManager = new FetchManager();
  }

  /**
   * 启动调度器：每分钟检查一次是否有源需要抓取
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // 主调度：每分钟检查一次
    const task = cron.schedule('* * * * *', async () => {
      try {
        await this.tick();
      } catch (err) {
        logger.error({ error: err }, 'Scheduler tick error');
      }
    });
    this.tasks.push(task);

    logger.info('Feed scheduler started');

    // 启动后立即执行一次
    this.tick().catch((err) => logger.error({ error: err }, 'Initial tick error'));
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    this.running = false;
    logger.info('Feed scheduler stopped');
  }

  /**
   * 执行一次抓取周期
   */
  async tick(): Promise<{ fetched: number; inserted: number }> {
    // 获取所有启用的源
    const sources = await db
      .select()
      .from(feedSources)
      .where(eq(feedSources.enabled, true));

    // 过滤出需要抓取的源（基于 lastFetchedAt + 间隔）
    const now = Date.now();
    const dueSource: FetchSource[] = [];

    for (const src of sources) {
      // 熔断检查
      if ((src.fetchErrorCount ?? 0) >= CIRCUIT_BREAKER_THRESHOLD) {
        continue;
      }

      const interval = (src.fetchConfig as any)?.intervalMinutes
        ?? DEFAULT_INTERVALS[src.tier] ?? 60;
      const intervalMs = interval * 60 * 1000;

      const lastFetched = src.lastFetchedAt ? new Date(src.lastFetchedAt).getTime() : 0;
      if (now - lastFetched >= intervalMs) {
        dueSource.push({
          id: src.id,
          url: src.url,
          name: src.name,
          type: src.type,
          tier: src.tier,
          fetchConfig: src.fetchConfig as Record<string, unknown> | undefined,
        });
      }
    }

    if (dueSource.length === 0) {
      return { fetched: 0, inserted: 0 };
    }

    logger.info({ count: dueSource.length }, 'Sources due for fetching');

    // 批量抓取
    const results = await this.fetchManager.fetchBatch(dueSource);

    // 处理结果
    let totalInserted = 0;
    const fetchedAt = new Date();

    for (const result of results) {
      // 更新源状态
      await updateSourceStatus(result);

      // 自动熔断
      if (result.status === 'error') {
        const src = sources.find((s) => s.id === result.source.id);
        const newErrorCount = (src?.fetchErrorCount ?? 0) + 1;
        if (newErrorCount >= CIRCUIT_BREAKER_THRESHOLD) {
          await db
            .update(feedSources)
            .set({ enabled: false })
            .where(eq(feedSources.id, result.source.id));
          logger.warn({ source: result.source.name, errors: newErrorCount }, 'Source auto-disabled (circuit breaker)');
        }
        continue;
      }

      if (result.items.length === 0) continue;

      // Normalize → Dedup → Store
      const normalized = normalize(result.items, result.source, fetchedAt);
      const deduped = dedup(normalized);
      const { inserted } = await storeItems(deduped);
      totalInserted += inserted;
    }

    logger.info({ sources: dueSource.length, inserted: totalInserted }, 'Fetch cycle complete');
    return { fetched: dueSource.length, inserted: totalInserted };
  }

  /**
   * 手动触发全量抓取（admin API 用）
   */
  async fetchAll(): Promise<{ fetched: number; inserted: number }> {
    const sources = await db
      .select()
      .from(feedSources)
      .where(eq(feedSources.enabled, true));

    const fetchSources: FetchSource[] = sources.map((src) => ({
      id: src.id,
      url: src.url,
      name: src.name,
      type: src.type,
      tier: src.tier,
      fetchConfig: src.fetchConfig as Record<string, unknown> | undefined,
    }));

    const results = await this.fetchManager.fetchBatch(fetchSources);
    const fetchedAt = new Date();
    let totalInserted = 0;

    for (const result of results) {
      await updateSourceStatus(result);
      if (result.status !== 'ok' || result.items.length === 0) continue;

      const normalized = normalize(result.items, result.source, fetchedAt);
      const deduped = dedup(normalized);
      const { inserted } = await storeItems(deduped);
      totalInserted += inserted;
    }

    return { fetched: fetchSources.length, inserted: totalInserted };
  }
}

// 单例
let schedulerInstance: FeedScheduler | null = null;

export function getScheduler(): FeedScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new FeedScheduler();
  }
  return schedulerInstance;
}
```

2. 将 scheduler 集成到 `packages/backend/src/index.ts`：

在 `serve()` 调用之后添加：

```typescript
// 在 index.ts 末尾，serve() 之后添加：
import { getScheduler } from './engine/scheduler.js';

// ... existing serve() code ...

// 启动 Feed 抓取调度器
const scheduler = getScheduler();
scheduler.start();

// graceful shutdown
process.on('SIGINT', () => {
  scheduler.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  scheduler.stop();
  process.exit(0);
});
```

**验收**：
```bash
cd ~/projects/arclight
# 手动执行一次 fetchAll，不启动 cron
npx tsx -e "
const { getScheduler } = await import('./packages/backend/src/engine/scheduler.js');
const scheduler = getScheduler();

console.log('Fetching all sources...');
const result = await scheduler.fetchAll();
console.log('Result:', result);
// 预期: { fetched: 26, inserted: N } 其中 N > 0（至少几十条）
// 部分源可能超时或被墙，fetched 应为可用源数量

// 查询 DB 确认
const { db } = await import('./packages/backend/src/db/client.js');
const { feedItems, feedSources } = await import('./packages/backend/src/db/schema.js');
const { count, eq } = await import('drizzle-orm');

const [{ value: itemCount }] = await db.select({ value: count() }).from(feedItems);
console.log('Total items in DB:', itemCount);  // 预期: > 0

const okSources = await db.select().from(feedSources).where(eq(feedSources.lastFetchStatus, 'ok'));
console.log('Sources fetched OK:', okSources.length);  // 预期: > 0
"
```

---

### B6. Source 健康监控 + Admin API

**依赖**：B5（可与 B5 并行开发，依赖 B4 完成）  
**目标**：添加 admin API 端点用于查看源状态、手动触发抓取、管理熔断。

**操作步骤**：

1. 创建 `packages/backend/src/routes/engine.ts`：

```typescript
// packages/backend/src/routes/engine.ts
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { feedSources, feedItems } from '../db/schema.js';
import { eq, sql, desc, count } from 'drizzle-orm';
import { requireAuth, requireAdmin, type AuthVariables } from '../middleware/auth.js';
import { getScheduler } from '../engine/scheduler.js';

const engineRoutes = new Hono<{ Variables: AuthVariables }>();

engineRoutes.use('*', requireAuth, requireAdmin);

// ── Source 健康状态 ──
engineRoutes.get('/sources/health', async (c) => {
  const sources = await db
    .select({
      id: feedSources.id,
      name: feedSources.name,
      type: feedSources.type,
      tier: feedSources.tier,
      enabled: feedSources.enabled,
      lastFetchedAt: feedSources.lastFetchedAt,
      lastFetchStatus: feedSources.lastFetchStatus,
      fetchErrorCount: feedSources.fetchErrorCount,
    })
    .from(feedSources)
    .orderBy(desc(feedSources.lastFetchedAt));

  return c.json({ data: sources });
});

// ── 手动触发全量抓取 ──
engineRoutes.post('/fetch', async (c) => {
  const scheduler = getScheduler();
  const result = await scheduler.fetchAll();
  return c.json({ data: result });
});

// ── 手动触发单源抓取 ──
engineRoutes.post('/fetch/:sourceId', async (c) => {
  const sourceId = c.req.param('sourceId');
  const source = await db.select().from(feedSources).where(eq(feedSources.id, sourceId)).get();
  if (!source) return c.json({ error: 'Source not found' }, 404);

  const scheduler = getScheduler();
  const fm = new (await import('../engine/fetch-manager.js')).FetchManager();
  const results = await fm.fetchBatch([{
    id: source.id,
    url: source.url,
    name: source.name,
    type: source.type,
    tier: source.tier,
    fetchConfig: source.fetchConfig as Record<string, unknown> | undefined,
  }]);

  return c.json({ data: results[0] });
});

// ── 重置熔断（重新启用被禁用的源）──
engineRoutes.post('/sources/:sourceId/reset', async (c) => {
  const sourceId = c.req.param('sourceId');
  await db
    .update(feedSources)
    .set({ enabled: true, fetchErrorCount: 0, lastFetchStatus: null })
    .where(eq(feedSources.id, sourceId));
  return c.json({ ok: true });
});

// ── 抓取统计 ──
engineRoutes.get('/stats', async (c) => {
  const [{ value: totalItems }] = await db.select({ value: count() }).from(feedItems);
  const [{ value: totalSources }] = await db.select({ value: count() }).from(feedSources);
  const [{ value: enabledSources }] = await db
    .select({ value: count() })
    .from(feedSources)
    .where(eq(feedSources.enabled, true));
  const [{ value: errorSources }] = await db
    .select({ value: count() })
    .from(feedSources)
    .where(eq(feedSources.lastFetchStatus, 'error'));

  return c.json({
    data: {
      totalItems,
      totalSources,
      enabledSources,
      errorSources,
    },
  });
});

export { engineRoutes };
```

2. 注册路由到 `index.ts`：

```typescript
// 在 index.ts 中添加：
import { engineRoutes } from './routes/engine.js';

// 在已有 source routes 之后添加：
app.route('/api/v1/engine', engineRoutes);
```

**验收**：
```bash
# 启动 dev server 后：

# 1. 先登录获取 session（假设已有 admin 账号）
# 2. 调用健康检查 API
curl -s http://localhost:3000/api/v1/engine/sources/health -b cookies.txt | head -c 200
# 预期: {"data":[{"id":"...","name":"...","lastFetchStatus":"ok",...},...]}

# 3. 手动触发全量抓取
curl -s -X POST http://localhost:3000/api/v1/engine/fetch -b cookies.txt
# 预期: {"data":{"fetched":N,"inserted":M}}

# 4. 查看统计
curl -s http://localhost:3000/api/v1/engine/stats -b cookies.txt
# 预期: {"data":{"totalItems":N,"totalSources":26,"enabledSources":N,...}}
```

---

## Phase C — User Preferences

### C1. Preferences CRUD API

**依赖**：无（可与 Phase B 并行）  
**目标**：实现用户偏好的 GET/PUT API，含 topics、schedule、ranking 配置。

**操作步骤**：

1. 创建 `packages/backend/src/routes/preferences.ts`：

```typescript
// packages/backend/src/routes/preferences.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/client.js';
import { userPreferences } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';

const preferencesRoutes = new Hono<{ Variables: AuthVariables }>();

preferencesRoutes.use('*', requireAuth);

// ── Topic schema ──
const topicSchema = z.object({
  name: z.string().min(1).max(100),
  keywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string()).optional().default([]),
  boost: z.number().min(0.1).max(5.0).default(1.0),
});

// ── Schedule schema ──
const scheduleItemSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^\d{2}:\d{2}$/),  // HH:MM
  count: z.number().int().min(1).max(20),
});

const scheduleSchema = z.object({
  flash: scheduleItemSchema.optional(),
  daily: scheduleItemSchema.optional(),
  deep: scheduleItemSchema.optional(),
  weekly: z.object({
    enabled: z.boolean(),
    dayOfWeek: z.number().int().min(0).max(6),
    time: z.string().regex(/^\d{2}:\d{2}$/),
  }).optional(),
  buzz: scheduleItemSchema.optional(),
});

// ── Ranking schema ──
const rankingSchema = z.object({
  tierWeights: z.record(z.string(), z.number()).optional(),
  buzzWeight: z.number().optional(),
  recencyHours: z.number().int().min(1).max(168).optional(),
  arcActiveBoost: z.number().optional(),
});

// ── GET preferences ──
preferencesRoutes.get('/', async (c) => {
  const user = c.get('user');
  let prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .get();

  // 如果没有偏好记录，创建默认的
  if (!prefs) {
    const defaultPrefs = getDefaultPreferences(user.id);
    await db.insert(userPreferences).values(defaultPrefs);
    prefs = defaultPrefs as any;
  }

  return c.json({ data: prefs });
});

// ── PUT preferences (全量更新) ──
const updatePrefsSchema = z.object({
  topics: z.array(topicSchema).optional(),
  schedule: scheduleSchema.optional(),
  ranking: rankingSchema.optional(),
  pushChannels: z.record(z.string(), z.unknown()).optional(),
  serendipity: z.object({
    enabled: z.boolean(),
    slotsPerDigest: z.number().int().min(0).max(5),
    strategy: z.string(),
    minBuzz: z.number().optional(),
  }).optional(),
  llmConfig: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    contextInjection: z.boolean().optional(),
    arcConfirm: z.boolean().optional(),
  }).optional(),
  alerts: z.object({
    enabled: z.boolean(),
    minBuzz: z.number().optional(),
    minTier1Sources: z.number().optional(),
    cooldownHours: z.number().optional(),
    quietHours: z.string().optional(),
  }).optional(),
});

preferencesRoutes.put('/', zValidator('json', updatePrefsSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  // Ensure prefs exist
  const existing = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .get();

  if (!existing) {
    const defaultPrefs = getDefaultPreferences(user.id);
    await db.insert(userPreferences).values({ ...defaultPrefs, ...body, updatedAt: new Date() });
  } else {
    await db
      .update(userPreferences)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(userPreferences.userId, user.id));
  }

  const updated = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).get();
  return c.json({ data: updated });
});

// ── PUT topics 只更新 topics ──
preferencesRoutes.put('/topics', zValidator('json', z.object({ topics: z.array(topicSchema) })), async (c) => {
  const user = c.get('user');
  const { topics } = c.req.valid('json');

  await ensurePrefsExist(user.id);
  await db
    .update(userPreferences)
    .set({ topics, updatedAt: new Date() })
    .where(eq(userPreferences.userId, user.id));

  return c.json({ ok: true, topics });
});

// ── PUT schedule 只更新 schedule ──
preferencesRoutes.put('/schedule', zValidator('json', z.object({ schedule: scheduleSchema })), async (c) => {
  const user = c.get('user');
  const { schedule } = c.req.valid('json');

  await ensurePrefsExist(user.id);
  await db
    .update(userPreferences)
    .set({ schedule, updatedAt: new Date() })
    .where(eq(userPreferences.userId, user.id));

  return c.json({ ok: true, schedule });
});

// ── 预定义 topic 模板 ──
preferencesRoutes.get('/topic-templates', async (c) => {
  return c.json({
    data: TOPIC_TEMPLATES,
  });
});

// ── Helpers ──

async function ensurePrefsExist(userId: string): Promise<void> {
  const existing = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .get();

  if (!existing) {
    await db.insert(userPreferences).values(getDefaultPreferences(userId));
  }
}

function getDefaultPreferences(userId: string) {
  return {
    id: nanoid(),
    userId,
    topics: [],
    ranking: {
      tierWeights: { '1': 2.0, '2': 1.5, '3': 1.0, '4': 0.7 },
      buzzWeight: 1.2,
      recencyHours: 24,
      arcActiveBoost: 1.3,
    },
    schedule: {
      flash: { enabled: true, time: '07:30', count: 8 },
      daily: { enabled: true, time: '09:00', count: 8 },
      deep: { enabled: true, time: '20:00', count: 2 },
    },
    pushChannels: { web: { enabled: true } },
    serendipity: { enabled: true, slotsPerDigest: 1, strategy: 'high_buzz_outside_topics' },
    llmConfig: { provider: process.env.LLM_PROVIDER || 'none', contextInjection: true },
    alerts: { enabled: false },
    updatedAt: new Date(),
  };
}

const TOPIC_TEMPLATES = [
  {
    name: 'AI/ML',
    keywords: ['OpenAI', 'Anthropic', 'Claude', 'GPT', 'Gemini', 'LLM', 'AI', 'machine learning', 'deep learning'],
    excludeKeywords: [],
    boost: 1.5,
  },
  {
    name: '前端开发',
    keywords: ['React', 'Vue', 'Next.js', 'TypeScript', 'JavaScript', 'CSS', 'Vite', 'Tailwind', 'Svelte'],
    excludeKeywords: [],
    boost: 1.0,
  },
  {
    name: '加密货币',
    keywords: ['Bitcoin', 'Ethereum', 'crypto', 'blockchain', 'DeFi', 'NFT', 'Web3'],
    excludeKeywords: [],
    boost: 1.0,
  },
  {
    name: '地缘政治',
    keywords: ['geopolitics', 'sanctions', 'trade war', 'NATO', 'UN', 'diplomacy', '外交', '制裁'],
    excludeKeywords: [],
    boost: 1.0,
  },
  {
    name: '创业投资',
    keywords: ['startup', 'funding', 'VC', 'Series A', 'IPO', 'Y Combinator', 'valuation', '融资', '估值'],
    excludeKeywords: [],
    boost: 1.0,
  },
  {
    name: 'Apple',
    keywords: ['Apple', 'iPhone', 'macOS', 'WWDC', 'Vision Pro', 'iPad', 'Swift', 'iOS'],
    excludeKeywords: ['apple juice', 'apple pie', 'apple cider'],
    boost: 1.0,
  },
];

export { preferencesRoutes };
```

2. 注册路由到 `index.ts`：

```typescript
import { preferencesRoutes } from './routes/preferences.js';

app.route('/api/v1/me/preferences', preferencesRoutes);
```

**验收**：
```bash
# GET 偏好（自动创建默认值）
curl -s http://localhost:3000/api/v1/me/preferences -b cookies.txt | python3 -m json.tool | head -20
# 预期: 返回包含 topics, schedule, ranking 的 JSON

# PUT topics
curl -s -X PUT http://localhost:3000/api/v1/me/preferences/topics \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"topics":[{"name":"AI","keywords":["OpenAI","Anthropic","GPT"],"boost":2.0}]}'
# 预期: {"ok":true,"topics":[...]}

# GET topic 模板
curl -s http://localhost:3000/api/v1/me/preferences/topic-templates -b cookies.txt
# 预期: {"data":[{"name":"AI/ML","keywords":[...],...},...]  } — 6 个模板
```

---

### C2. Topic 偏好编辑页面（前端）

**依赖**：C1  
**目标**：实现 Topic 偏好的增删改 UI，含关键词编辑 + 权重 slider + 模板导入。

**操作步骤**：

1. 需要安装的 shadcn 组件（如还没装）：

```bash
cd ~/projects/arclight/packages/frontend
npx shadcn@latest add slider dialog badge
```

2. 创建 `packages/frontend/src/pages/SettingsTopics.tsx`：

```typescript
// packages/frontend/src/pages/SettingsTopics.tsx
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Topic {
  name: string;
  keywords: string[];
  excludeKeywords?: string[];
  boost: number;
}

export default function SettingsTopics() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [templates, setTemplates] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 编辑弹窗状态
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editTopic, setEditTopic] = useState<Topic>({ name: '', keywords: [], boost: 1.0 });
  const [keywordInput, setKeywordInput] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [prefsRes, templatesRes] = await Promise.all([
        api.get<{ data: { topics: Topic[] } }>('/api/v1/me/preferences'),
        api.get<{ data: Topic[] }>('/api/v1/me/preferences/topic-templates'),
      ]);
      setTopics(prefsRes.data.topics || []);
      setTemplates(templatesRes.data);
    } finally {
      setLoading(false);
    }
  }

  async function saveTopics(newTopics: Topic[]) {
    setSaving(true);
    try {
      await api.put('/api/v1/me/preferences/topics', { topics: newTopics });
      setTopics(newTopics);
    } finally {
      setSaving(false);
    }
  }

  function openAddDialog() {
    setEditIndex(null);
    setEditTopic({ name: '', keywords: [], boost: 1.0 });
    setKeywordInput('');
    setDialogOpen(true);
  }

  function openEditDialog(index: number) {
    setEditIndex(index);
    setEditTopic({ ...topics[index] });
    setKeywordInput('');
    setDialogOpen(true);
  }

  function addKeyword() {
    const kw = keywordInput.trim();
    if (kw && !editTopic.keywords.includes(kw)) {
      setEditTopic({ ...editTopic, keywords: [...editTopic.keywords, kw] });
    }
    setKeywordInput('');
  }

  function removeKeyword(kw: string) {
    setEditTopic({ ...editTopic, keywords: editTopic.keywords.filter((k) => k !== kw) });
  }

  function saveTopic() {
    if (!editTopic.name || editTopic.keywords.length === 0) return;
    const newTopics = [...topics];
    if (editIndex !== null) {
      newTopics[editIndex] = editTopic;
    } else {
      newTopics.push(editTopic);
    }
    saveTopics(newTopics);
    setDialogOpen(false);
  }

  function removeTopic(index: number) {
    const newTopics = topics.filter((_, i) => i !== index);
    saveTopics(newTopics);
  }

  function addTemplate(template: Topic) {
    // 避免重复添加
    if (topics.some((t) => t.name === template.name)) return;
    saveTopics([...topics, template]);
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Topic 偏好配置</h1>
        <p className="text-neutral-500 mt-1">管理你关注的 Topic，影响 Digest 中新闻的排序权重。</p>
      </div>

      {/* Topic 列表 */}
      {topics.map((topic, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{topic.name}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEditDialog(i)}>编辑</Button>
                <Button variant="outline" size="sm" onClick={() => removeTopic(i)}>×</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {topic.keywords.map((kw) => (
                  <Badge key={kw} variant="secondary">{kw}</Badge>
                ))}
              </div>
              {topic.excludeKeywords && topic.excludeKeywords.length > 0 && (
                <div className="text-sm text-neutral-500">
                  排除: {topic.excludeKeywords.join(', ')}
                </div>
              )}
              <div className="text-sm text-neutral-500">
                权重: {'█'.repeat(Math.round(topic.boost * 5))}{'░'.repeat(10 - Math.round(topic.boost * 5))} {topic.boost}x
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button onClick={openAddDialog}>+ 添加 Topic</Button>

      {/* 推荐模板 */}
      <div className="pt-4 border-t">
        <h3 className="font-semibold mb-2">推荐 Topic 模板</h3>
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <Button
              key={t.name}
              variant="outline"
              size="sm"
              disabled={topics.some((existing) => existing.name === t.name)}
              onClick={() => addTemplate(t)}
            >
              {t.name}
            </Button>
          ))}
        </div>
      </div>

      {/* 编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editIndex !== null ? '编辑 Topic' : '添加 Topic'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">名称</label>
              <Input
                value={editTopic.name}
                onChange={(e) => setEditTopic({ ...editTopic, name: e.target.value })}
                placeholder="如: AI 产业"
              />
            </div>
            <div>
              <label className="text-sm font-medium">关键词</label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                  placeholder="输入关键词后回车"
                />
                <Button onClick={addKeyword} variant="outline">添加</Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {editTopic.keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="cursor-pointer" onClick={() => removeKeyword(kw)}>
                    {kw} ×
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">权重: {editTopic.boost}x</label>
              <Slider
                value={[editTopic.boost]}
                onValueChange={([v]) => setEditTopic({ ...editTopic, boost: Math.round(v * 10) / 10 })}
                min={0.1}
                max={5.0}
                step={0.1}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={saveTopic} disabled={!editTopic.name || editTopic.keywords.length === 0}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

3. 更新 `App.tsx` 路由：

```typescript
// 添加 import
import SettingsTopics from '@/pages/SettingsTopics';

// 在 <Route element={<AppLayout />}> 内添加：
<Route path="/settings/topics" element={<SettingsTopics />} />
```

4. 更新 Sidebar 导航添加 Topics 入口（在 `AppLayout.tsx` 中）。

**验收**：
```bash
# 启动前端 dev server
npm run dev

# 浏览器访问 http://localhost:5173/settings/topics
# 预期:
# 1. 页面加载，显示 "Topic 偏好配置" 标题
# 2. 底部显示 6 个推荐模板按钮
# 3. 点击模板按钮 → Topic 被添加到列表
# 4. 点击 "+ 添加 Topic" → 弹窗出现
# 5. 输入名称、添加关键词、调整权重 slider → 保存成功
# 6. 编辑已有 Topic → 修改生效
# 7. 删除 Topic → 从列表移除
# 8. 刷新页面后数据依然存在（从 API 加载）
```

---

### C3. Schedule 配置页面（前端）

**依赖**：C1  
**目标**：实现 Flash/Daily/Deep 推送时间配置 UI。

**操作步骤**：

1. 创建 `packages/frontend/src/pages/SettingsSchedule.tsx`：

```typescript
// packages/frontend/src/pages/SettingsSchedule.tsx
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface ScheduleItem {
  enabled: boolean;
  time: string;
  count: number;
}

interface Schedule {
  flash?: ScheduleItem;
  daily?: ScheduleItem;
  deep?: ScheduleItem;
}

const TIER_INFO = {
  flash: { emoji: '⚡', name: 'Flash', desc: '速览标题，60 秒掌握全局', defaultCount: 8 },
  daily: { emoji: '📰', name: 'Daily', desc: '今日精选，标题+背景', defaultCount: 8 },
  deep:  { emoji: '🔍', name: 'Deep',  desc: '深度推荐，含长摘要', defaultCount: 2 },
};

export default function SettingsSchedule() {
  const [schedule, setSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ data: { schedule: Schedule } }>('/api/v1/me/preferences').then((res) => {
      setSchedule(res.data.schedule || {});
      setLoading(false);
    });
  }, []);

  async function save(newSchedule: Schedule) {
    setSaving(true);
    try {
      await api.put('/api/v1/me/preferences/schedule', { schedule: newSchedule });
      setSchedule(newSchedule);
    } finally {
      setSaving(false);
    }
  }

  function updateTier(tier: keyof Schedule, updates: Partial<ScheduleItem>) {
    const info = TIER_INFO[tier];
    const current = schedule[tier] || { enabled: false, time: '09:00', count: info.defaultCount };
    const newSchedule = { ...schedule, [tier]: { ...current, ...updates } };
    save(newSchedule);
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">推送时间表</h1>
        <p className="text-neutral-500 mt-1">配置每天收到 Digest 的时间和条目数量。</p>
      </div>

      {(Object.keys(TIER_INFO) as (keyof typeof TIER_INFO)[]).map((tier) => {
        const info = TIER_INFO[tier];
        const item = schedule[tier] || { enabled: false, time: '09:00', count: info.defaultCount };

        return (
          <Card key={tier}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{info.emoji} {info.name}</CardTitle>
                  <CardDescription>{info.desc}</CardDescription>
                </div>
                <Switch
                  checked={item.enabled}
                  onCheckedChange={(enabled) => updateTier(tier, { enabled })}
                />
              </div>
            </CardHeader>
            {item.enabled && (
              <CardContent>
                <div className="flex gap-4 items-center">
                  <div>
                    <label className="text-sm font-medium">时间</label>
                    <Input
                      type="time"
                      value={item.time}
                      onChange={(e) => updateTier(tier, { time: e.target.value })}
                      className="w-32"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">条目数</label>
                    <Input
                      type="number"
                      value={item.count}
                      min={1}
                      max={20}
                      onChange={(e) => updateTier(tier, { count: parseInt(e.target.value) || info.defaultCount })}
                      className="w-20"
                    />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
```

2. 添加路由：

```typescript
import SettingsSchedule from '@/pages/SettingsSchedule';

<Route path="/settings/schedule" element={<SettingsSchedule />} />
```

**验收**：
```bash
# 浏览器访问 http://localhost:5173/settings/schedule
# 预期:
# 1. 显示 Flash / Daily / Deep 三个卡片
# 2. 每个卡片有开关、时间选择器、条目数输入
# 3. 开关切换 → API 调用 → 刷新后状态保持
# 4. 修改时间/条目数 → 保存成功
```

---

### C4. 预定义 Topic 模板

**依赖**：无（已在 C1 中实现 `/topic-templates` API 端点）  
**目标**：确保模板数据完备，前端可正确加载。

此任务已在 C1 中完成（`TOPIC_TEMPLATES` 常量 + API 端点）。C2 的前端也已集成模板导入功能。

**验收**：
```bash
curl -s http://localhost:3000/api/v1/me/preferences/topic-templates -b cookies.txt | python3 -m json.tool
# 预期: 返回 6 个模板对象的数组
```

---

## Phase D — Digest 引擎

### D1. Pipeline 编排器（per-user Digest 生成）

**依赖**：B4（feed_items 已写入 DB）、C1（preferences API 可用）  
**目标**：实现 Digest 生成的主 pipeline，从 DB 读取 items → 过滤 → 排序 → 渲染 → 存储。

**操作步骤**：

1. 创建 `packages/backend/src/engine/digest/pipeline.ts`：

```typescript
// packages/backend/src/engine/digest/pipeline.ts
import { db } from '../../db/client.js';
import { feedItems, userPreferences, digests } from '../../db/schema.js';
import { eq, desc, sql, gte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { rankItems, type RankedItem } from './ranking.js';
import { renderDigest, type DigestTier } from './renderer.js';
import { batchContextInject } from './context-inject.js';
import { logger } from '../../shared/logger.js';

export interface GenerateOptions {
  userId: string;
  tier: DigestTier;
  date?: string;        // YYYY-MM-DD，默认今天
  dryRun?: boolean;      // true = 不写入 DB
}

export interface GenerateResult {
  id: string;
  tier: DigestTier;
  date: string;
  contentMarkdown: string;
  contentHtml: string;
  items: RankedItem[];
  metadata: {
    itemCount: number;
    generatedAt: string;
    pipelineDurationMs: number;
  };
}

export async function generateDigest(options: GenerateOptions): Promise<GenerateResult> {
  const start = Date.now();
  const { userId, tier, dryRun = false } = options;
  const date = options.date || new Date().toISOString().split('T')[0];

  logger.info({ userId, tier, date }, 'Generating digest');

  // 1. 获取用户偏好
  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .get();

  const topics = (prefs?.topics as any[]) || [];
  const ranking = (prefs?.ranking as any) || {};
  const schedule = (prefs?.schedule as any) || {};
  const llmConfig = (prefs?.llmConfig as any) || {};

  // 获取 tier 对应的 count
  const tierConfig = schedule[tier];
  const itemCount = tierConfig?.count || getDefaultCount(tier);

  // 2. 从 DB 查询最近 N 小时的 items
  const recencyHours = ranking.recencyHours || 24;
  const since = new Date(Date.now() - recencyHours * 60 * 60 * 1000);

  const items = await db
    .select()
    .from(feedItems)
    .where(gte(feedItems.fetchedAt, since))
    .orderBy(desc(feedItems.publishedAt))
    .limit(500);  // 查询上限，避免过多数据

  if (items.length === 0) {
    logger.warn({ userId, tier }, 'No items found for digest');
    return {
      id: nanoid(),
      tier,
      date,
      contentMarkdown: `# ${tierEmoji(tier)} ${date}\n\n暂无新内容。`,
      contentHtml: `<h1>${tierEmoji(tier)} ${date}</h1><p>暂无新内容。</p>`,
      items: [],
      metadata: {
        itemCount: 0,
        generatedAt: new Date().toISOString(),
        pipelineDurationMs: Date.now() - start,
      },
    };
  }

  // 3. Ranking
  const rankedItems = rankItems(items as any[], {
    topics,
    tierWeights: ranking.tierWeights || { '1': 2.0, '2': 1.5, '3': 1.0, '4': 0.7 },
    recencyHours,
  });

  // 4. 取 top N
  const topItems = rankedItems.slice(0, itemCount);

  // 5. Context Injection（如果启用 LLM）
  if (llmConfig.contextInjection && llmConfig.provider !== 'none' && tier !== 'flash') {
    try {
      const contexts = await batchContextInject(topItems);
      for (const item of topItems) {
        if (contexts.has(item.id)) {
          item.contextInjection = contexts.get(item.id)!;
        }
      }
    } catch (err) {
      logger.warn({ error: err }, 'Context injection failed, continuing without');
    }
  }

  // 6. 渲染
  const { markdown, html } = renderDigest(topItems, tier, date);

  // 7. 存储
  const digestId = nanoid();
  if (!dryRun) {
    await db.insert(digests).values({
      id: digestId,
      userId,
      tier,
      date,
      contentMarkdown: markdown,
      contentHtml: html,
      itemIds: topItems.map((i) => i.id),
      metadata: {
        itemCount: topItems.length,
        generatedAt: new Date().toISOString(),
        pipelineDurationMs: Date.now() - start,
      },
      createdAt: new Date(),
      pushStatus: 'pending',
    });
    logger.info({ digestId, tier, items: topItems.length, durationMs: Date.now() - start }, 'Digest generated');
  }

  return {
    id: digestId,
    tier,
    date,
    contentMarkdown: markdown,
    contentHtml: html,
    items: topItems,
    metadata: {
      itemCount: topItems.length,
      generatedAt: new Date().toISOString(),
      pipelineDurationMs: Date.now() - start,
    },
  };
}

function getDefaultCount(tier: DigestTier): number {
  switch (tier) {
    case 'flash': return 8;
    case 'daily': return 8;
    case 'deep': return 2;
    default: return 8;
  }
}

function tierEmoji(tier: DigestTier): string {
  switch (tier) {
    case 'flash': return '⚡';
    case 'daily': return '📰';
    case 'deep': return '🔍';
    default: return '📰';
  }
}
```

**验收**：在 D3 完成后统一验收（pipeline 依赖 ranking 和 renderer）。

---

### D2. Ranking Engine（tier weight + topic match + recency）

**依赖**：D1  
**目标**：实现排序引擎，综合 tier 权重、topic 匹配度、时效性计算最终分数。

**操作步骤**：

1. 创建 `packages/backend/src/engine/digest/ranking.ts`：

```typescript
// packages/backend/src/engine/digest/ranking.ts

export interface RankedItem {
  id: string;
  sourceId: string;
  url: string;
  title: string;
  content: string;
  author: any;
  language: string | null;
  tier: number;
  publishedAt: Date | null;
  fetchedAt: Date;
  entities: string[];
  tags: string[];
  // Ranking 附加字段
  score: number;
  topicMatches: string[];
  contextInjection?: string;
}

export interface RankingOptions {
  topics: {
    name: string;
    keywords: string[];
    excludeKeywords?: string[];
    boost: number;
  }[];
  tierWeights: Record<string, number>;
  recencyHours: number;
}

/**
 * 排序公式：
 * score = tierWeight × topicBoost × recencyScore
 *
 * 其中：
 * - tierWeight: { 1: 2.0, 2: 1.5, 3: 1.0, 4: 0.7 }
 * - topicBoost: 匹配到的 topic 的 boost 之和（至少 1.0）
 * - recencyScore: 基于发布时间的衰减因子（0-1），越新越高
 */
export function rankItems(items: any[], options: RankingOptions): RankedItem[] {
  const now = Date.now();

  const ranked: RankedItem[] = items.map((item) => {
    // 1. Tier weight
    const tierWeight = options.tierWeights[String(item.tier)] ?? 1.0;

    // 2. Topic match
    const { boost: topicBoost, matches } = computeTopicBoost(item, options.topics);

    // 3. Recency score（指数衰减）
    const publishedAt = item.publishedAt ? new Date(item.publishedAt).getTime() : item.fetchedAt ? new Date(item.fetchedAt).getTime() : now;
    const hoursAgo = (now - publishedAt) / (1000 * 60 * 60);
    const recencyScore = Math.exp(-hoursAgo / options.recencyHours);

    // 综合分数
    const score = tierWeight * topicBoost * recencyScore;

    return {
      id: item.id,
      sourceId: item.sourceId,
      url: item.url,
      title: item.title || '',
      content: item.content || '',
      author: item.author,
      language: item.language,
      tier: item.tier,
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
      fetchedAt: new Date(item.fetchedAt),
      entities: item.entities || [],
      tags: item.tags || [],
      score,
      topicMatches: matches,
    };
  });

  // 按分数降序排列
  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}

function computeTopicBoost(
  item: any,
  topics: RankingOptions['topics'],
): { boost: number; matches: string[] } {
  if (topics.length === 0) return { boost: 1.0, matches: [] };

  const text = `${item.title || ''} ${item.content || ''}`.toLowerCase();
  const entities = (item.entities || []).map((e: string) => e.toLowerCase());
  let totalBoost = 0;
  const matches: string[] = [];

  for (const topic of topics) {
    // 排除关键词检查
    if (topic.excludeKeywords?.some((kw) => text.includes(kw.toLowerCase()))) {
      continue;
    }

    // 匹配关键词
    const hit = topic.keywords.some((kw) => {
      const kwLower = kw.toLowerCase();
      return text.includes(kwLower) || entities.includes(kwLower);
    });

    if (hit) {
      totalBoost += topic.boost;
      matches.push(topic.name);
    }
  }

  // 至少返回 1.0（无 topic 配置时不惩罚）
  return {
    boost: Math.max(1.0, totalBoost === 0 ? 1.0 : totalBoost),
    matches,
  };
}
```

**验收**：
```bash
cd ~/projects/arclight
npx tsx -e "
const { rankItems } = await import('./packages/backend/src/engine/digest/ranking.js');

const items = [
  { id: '1', title: 'OpenAI releases GPT-5', tier: 1, publishedAt: new Date(), fetchedAt: new Date(), entities: ['OpenAI'], content: '', tags: [] },
  { id: '2', title: 'Local weather update', tier: 3, publishedAt: new Date(Date.now() - 12*3600000), fetchedAt: new Date(), entities: [], content: '', tags: [] },
  { id: '3', title: 'Anthropic Claude 4 launched', tier: 2, publishedAt: new Date(Date.now() - 2*3600000), fetchedAt: new Date(), entities: ['Anthropic'], content: '', tags: [] },
];

const ranked = rankItems(items, {
  topics: [{ name: 'AI', keywords: ['OpenAI', 'Anthropic', 'GPT'], boost: 2.0, excludeKeywords: [] }],
  tierWeights: { '1': 2.0, '2': 1.5, '3': 1.0, '4': 0.7 },
  recencyHours: 24,
});

for (const r of ranked) {
  console.log(r.title.padEnd(35), 'score:', r.score.toFixed(3), 'topics:', r.topicMatches);
}
// 预期: OpenAI 排第一（tier 1 + topic match），Anthropic 第二，weather 最后
"
```

---

### D3. Multi-tier Renderer（Flash / Daily / Deep）

**依赖**：D2  
**目标**：实现三种 tier 的 Markdown + HTML 渲染器。

**操作步骤**：

1. 创建 `packages/backend/src/engine/digest/renderer.ts`：

```typescript
// packages/backend/src/engine/digest/renderer.ts
import type { RankedItem } from './ranking.js';

export type DigestTier = 'flash' | 'daily' | 'deep' | 'weekly' | 'buzz' | 'alert';

export interface RenderOutput {
  markdown: string;
  html: string;
}

export function renderDigest(items: RankedItem[], tier: DigestTier, date: string): RenderOutput {
  switch (tier) {
    case 'flash':
      return renderFlash(items, date);
    case 'daily':
      return renderDaily(items, date);
    case 'deep':
      return renderDeep(items, date);
    default:
      return renderDaily(items, date);
  }
}

// ── Flash: 纯标题列表，60 秒速览 ──

function renderFlash(items: RankedItem[], date: string): RenderOutput {
  const lines = items.map((item, i) => {
    const tierIcon = tierBadge(item.tier);
    return `${i + 1}. ${tierIcon} ${item.title}`;
  });

  const markdown = `# ⚡ Flash — ${date}\n\n${lines.join('\n')}\n`;

  const htmlItems = items.map((item, i) => {
    const tierIcon = tierBadge(item.tier);
    return `<li>${tierIcon} <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a></li>`;
  });

  const html = `<h1>⚡ Flash — ${date}</h1>\n<ol>\n${htmlItems.join('\n')}\n</ol>`;

  return { markdown, html };
}

// ── Daily: 标题 + 背景 + topic 标签 ──

function renderDaily(items: RankedItem[], date: string): RenderOutput {
  const sections = items.map((item, i) => {
    const tierIcon = tierBadge(item.tier);
    let md = `### ${i + 1}. ${tierIcon} ${item.title}\n`;

    if (item.contextInjection) {
      md += `\n📎 ${item.contextInjection}\n`;
    }

    if (item.topicMatches.length > 0) {
      md += `\n🏷️ ${item.topicMatches.join(', ')}\n`;
    }

    md += `\n🔗 [阅读原文](${item.url})\n`;
    return md;
  });

  const markdown = `# 📰 今日精选 — ${date}\n\n${sections.join('\n---\n\n')}\n`;

  // HTML version
  const htmlSections = items.map((item, i) => {
    const tierIcon = tierBadge(item.tier);
    let section = `<div class="digest-item" style="margin-bottom:1.5em;padding-bottom:1.5em;border-bottom:1px solid #eee">`;
    section += `<h3>${i + 1}. ${tierIcon} ${escapeHtml(item.title)}</h3>`;

    if (item.contextInjection) {
      section += `<p style="color:#666;font-size:0.9em">📎 ${escapeHtml(item.contextInjection)}</p>`;
    }

    if (item.topicMatches.length > 0) {
      section += `<p style="font-size:0.85em">🏷️ ${item.topicMatches.map(t => `<span style="background:#f0f0f0;padding:2px 6px;border-radius:4px;margin-right:4px">${escapeHtml(t)}</span>`).join('')}</p>`;
    }

    section += `<p><a href="${escapeHtml(item.url)}" target="_blank">🔗 阅读原文</a></p>`;
    section += `</div>`;
    return section;
  });

  const html = `<h1>📰 今日精选 — ${date}</h1>\n${htmlSections.join('\n')}`;

  return { markdown, html };
}

// ── Deep: 长摘要 + 背景 + 为什么重要 ──

function renderDeep(items: RankedItem[], date: string): RenderOutput {
  const sections = items.map((item, i) => {
    const tierIcon = tierBadge(item.tier);
    let md = `## ${i + 1}. ${tierIcon} ${item.title}\n\n`;

    if (item.contextInjection) {
      md += `> 📎 **背景**：${item.contextInjection}\n\n`;
    }

    // Deep tier 使用 content 作为摘要
    if (item.content) {
      const summary = item.content.slice(0, 500);
      md += `${summary}${item.content.length > 500 ? '...' : ''}\n\n`;
    }

    if (item.topicMatches.length > 0) {
      md += `🏷️ ${item.topicMatches.join(', ')}\n\n`;
    }

    md += `🔗 [阅读原文](${item.url})\n`;
    return md;
  });

  const markdown = `# 🔍 深度推荐 — ${date}\n\n${sections.join('\n---\n\n')}\n`;

  const htmlSections = items.map((item, i) => {
    const tierIcon = tierBadge(item.tier);
    let section = `<div class="digest-item-deep" style="margin-bottom:2em">`;
    section += `<h2>${i + 1}. ${tierIcon} ${escapeHtml(item.title)}</h2>`;

    if (item.contextInjection) {
      section += `<blockquote style="border-left:3px solid #ddd;padding-left:1em;color:#555">📎 <strong>背景</strong>：${escapeHtml(item.contextInjection)}</blockquote>`;
    }

    if (item.content) {
      const summary = item.content.slice(0, 500);
      section += `<p>${escapeHtml(summary)}${item.content.length > 500 ? '...' : ''}</p>`;
    }

    section += `<p><a href="${escapeHtml(item.url)}" target="_blank">🔗 阅读原文</a></p>`;
    section += `</div>`;
    return section;
  });

  const html = `<h1>🔍 深度推荐 — ${date}</h1>\n${htmlSections.join('\n<hr/>\n')}`;

  return { markdown, html };
}

// ── Helpers ──

function tierBadge(tier: number): string {
  switch (tier) {
    case 1: return '🔴';  // T1 一手源
    case 2: return '🟠';  // T2 权威媒体
    case 3: return '🟡';  // T3 行业博客
    case 4: return '🟢';  // T4 社区
    default: return '⚪';
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

2. 创建目录结构：

```bash
mkdir -p ~/projects/arclight/packages/backend/src/engine/digest
```

**验收**（D1+D2+D3 综合验收）：
```bash
cd ~/projects/arclight
# 先确保 DB 中有 items（运行过 B5 的 fetchAll）
# 然后测试完整 pipeline：
npx tsx -e "
const { generateDigest } = await import('./packages/backend/src/engine/digest/pipeline.js');
const { db } = await import('./packages/backend/src/db/client.js');
const { users } = await import('./packages/backend/src/db/schema.js');

// 获取 admin 用户 ID
const adminUser = await db.select().from(users).limit(1).then(r => r[0]);
if (!adminUser) { console.log('No user found, run seed first'); process.exit(1); }
console.log('User:', adminUser.email);

// 生成 Flash
const flash = await generateDigest({ userId: adminUser.id, tier: 'flash', dryRun: true });
console.log('\n=== FLASH ===');
console.log('Items:', flash.items.length);    // 预期: 8（或当前所有 items 如果 <8）
console.log('Duration:', flash.metadata.pipelineDurationMs + 'ms');
console.log(flash.contentMarkdown.slice(0, 300));

// 生成 Daily
const daily = await generateDigest({ userId: adminUser.id, tier: 'daily', dryRun: true });
console.log('\n=== DAILY ===');
console.log('Items:', daily.items.length);
console.log(daily.contentMarkdown.slice(0, 500));

// 生成 Deep
const deep = await generateDigest({ userId: adminUser.id, tier: 'deep', dryRun: true });
console.log('\n=== DEEP ===');
console.log('Items:', deep.items.length);     // 预期: 2
console.log(deep.contentMarkdown.slice(0, 500));
"
# 预期: 三种 tier 都生成成功，Markdown 格式正确，items 数量符合预期
```

---

### D4. LLM Client 封装（Vercel AI SDK）

**依赖**：无（可与 D1-D3 并行）  
**目标**：封装 LLM 调用，支持 OpenAI/Anthropic/Ollama/none 四种 provider。

**操作步骤**：

1. 创建 `packages/backend/src/engine/llm/client.ts`：

```typescript
// packages/backend/src/engine/llm/client.ts
import { generateText, generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { logger } from '../../shared/logger.js';

export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'none';

export interface LLMClientConfig {
  provider: LLMProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * LLM Client 封装
 * 支持 provider=none 的降级路径（所有方法返回空结果）
 */
export class LLMClient {
  private config: LLMClientConfig;
  private model: LanguageModel | null = null;

  constructor(config?: LLMClientConfig) {
    this.config = config || {
      provider: (process.env.LLM_PROVIDER as LLMProvider) || 'none',
      model: process.env.LLM_MODEL,
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.OLLAMA_BASE_URL,
    };
  }

  get isEnabled(): boolean {
    return this.config.provider !== 'none';
  }

  /**
   * 延迟初始化 model（避免 provider=none 时报错）
   */
  private async getModel(): Promise<LanguageModel> {
    if (this.model) return this.model;

    switch (this.config.provider) {
      case 'openai': {
        const { openai } = await import('@ai-sdk/openai');
        this.model = openai(this.config.model || 'gpt-4o-mini');
        break;
      }
      case 'anthropic': {
        const { anthropic } = await import('@ai-sdk/anthropic');
        this.model = anthropic(this.config.model || 'claude-sonnet-4-20250514');
        break;
      }
      case 'ollama': {
        // Ollama 通过 OpenAI-compatible API
        const { createOpenAI } = await import('@ai-sdk/openai');
        const ollama = createOpenAI({
          baseURL: this.config.baseUrl || 'http://localhost:11434/v1',
          apiKey: 'ollama',
        });
        this.model = ollama(this.config.model || 'llama3.2');
        break;
      }
      default:
        throw new Error(`LLM provider "${this.config.provider}" not supported`);
    }

    return this.model!;
  }

  async text(prompt: string, system?: string): Promise<string> {
    if (!this.isEnabled) return '';

    try {
      const model = await this.getModel();
      const { text } = await generateText({
        model,
        system,
        prompt,
      });
      return text;
    } catch (err) {
      logger.error({ error: err }, 'LLM text generation failed');
      return '';
    }
  }

  async json<T>(prompt: string, schema: z.ZodSchema<T>, system?: string): Promise<T | null> {
    if (!this.isEnabled) return null;

    try {
      const model = await this.getModel();
      const { object } = await generateObject({
        model,
        system,
        prompt,
        schema,
      });
      return object;
    } catch (err) {
      logger.error({ error: err }, 'LLM JSON generation failed');
      return null;
    }
  }
}

// 单例
let llmInstance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmInstance) {
    llmInstance = new LLMClient();
  }
  return llmInstance;
}
```

**验收**：
```bash
cd ~/projects/arclight
# 测试 provider=none（不需要 API key）
LLM_PROVIDER=none npx tsx -e "
const { getLLMClient } = await import('./packages/backend/src/engine/llm/client.js');
const llm = getLLMClient();
console.log('Enabled:', llm.isEnabled);          // 预期: false
const text = await llm.text('Hello');
console.log('Text result:', JSON.stringify(text));  // 预期: ''
console.log('None provider works correctly');
"

# 如果有 OpenAI key，可选测试：
# LLM_PROVIDER=openai LLM_API_KEY=sk-... npx tsx -e "..."
```

---

### D5. Context Injection（batch LLM 生成一句话背景）

**依赖**：D4  
**目标**：实现 batch context injection，为 items 批量生成一句话背景。`LLM_PROVIDER=none` 时返回空 map。

**操作步骤**：

1. 创建 `packages/backend/src/engine/digest/context-inject.ts`：

```typescript
// packages/backend/src/engine/digest/context-inject.ts
import { z } from 'zod';
import { getLLMClient } from '../llm/client.js';
import type { RankedItem } from './ranking.js';
import { logger } from '../../shared/logger.js';

const contextResultSchema = z.array(
  z.object({
    id: z.number(),
    context: z.string().nullable(),
  }),
);

/**
 * 批量 Context Injection
 * 为每条新闻生成一句话背景（30字以内）
 *
 * LLM_PROVIDER=none 时直接返回空 Map
 */
export async function batchContextInject(
  items: RankedItem[],
): Promise<Map<string, string>> {
  const llm = getLLMClient();

  if (!llm.isEnabled || items.length === 0) {
    return new Map();
  }

  const BATCH_SIZE = 8;
  const result = new Map<string, string>();

  // 分批处理
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const prompt = `你是一个新闻背景注入器。对以下每条新闻标题，生成一句话（30字以内中文 / 50字以内英文）的背景上下文，帮助读者理解"这件事的来龙去脉"。
如果新闻本身就足够清晰不需要背景，返回 null。

Items:
${batch.map((it, idx) => `${idx + 1}. "${it.title}"`).join('\n')}

请返回 JSON 数组，每个元素包含 id (从1开始) 和 context (string 或 null)。`;

    try {
      const contexts = await llm.json(prompt, contextResultSchema);
      if (contexts) {
        for (const ctx of contexts) {
          if (ctx.context && ctx.id >= 1 && ctx.id <= batch.length) {
            result.set(batch[ctx.id - 1].id, ctx.context);
          }
        }
      }
    } catch (err) {
      logger.warn({ error: err, batchStart: i }, 'Context injection batch failed');
    }
  }

  logger.info({ total: items.length, injected: result.size }, 'Context injection complete');
  return result;
}
```

**验收**：
```bash
cd ~/projects/arclight
# provider=none 测试
LLM_PROVIDER=none npx tsx -e "
const { batchContextInject } = await import('./packages/backend/src/engine/digest/context-inject.js');
const items = [
  { id: '1', title: 'OpenAI releases GPT-5', sourceId: 's1', url: 'u1', content: '', author: null, language: 'en', tier: 1, publishedAt: null, fetchedAt: new Date(), entities: [], tags: [], score: 1, topicMatches: [] },
];
const result = await batchContextInject(items);
console.log('Result size:', result.size);   // 预期: 0（provider=none）
console.log('Graceful degradation works');
"
```

---

### D6. Digest 定时生成 Job

**依赖**：D3, D5  
**目标**：集成 Digest 生成到 scheduler
**操作步骤**：

1. 创建 `packages/backend/src/scheduler/jobs/generate-digest.ts`：

```typescript
import { db } from '../../db/client.js';
import { userPreferences, users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { generateDigest } from '../../engine/digest/pipeline.js';
import { logger } from '../../shared/logger.js';

/**
 * Check all users' schedules and generate digests when due.
 * Called every minute by the scheduler.
 */
export async function checkAndGenerateDigests(): Promise<void> {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const allPrefs = db.select().from(userPreferences).all();

  for (const pref of allPrefs) {
    const schedule = pref.schedule as any;
    if (!schedule) continue;

    for (const tier of ['flash', 'daily', 'deep'] as const) {
      const tierSchedule = schedule[tier];
      if (!tierSchedule?.enabled || tierSchedule.time !== currentTime) continue;

      try {
        logger.info({ userId: pref.userId, tier, time: currentTime }, 'Generating scheduled digest');
        await generateDigest(pref.userId, {
          tier,
          count: tierSchedule.count || (tier === 'flash' ? 8 : tier === 'daily' ? 8 : 2),
        });
      } catch (err) {
        logger.error({ err, userId: pref.userId, tier }, 'Scheduled digest generation failed');
      }
    }
  }
}
```

2. 在 `packages/backend/src/index.ts` 注册 cron job：

```typescript
import cron from 'node-cron';
import { checkAndGenerateDigests } from './scheduler/jobs/generate-digest.js';

// Every minute, check if any user needs a digest
cron.schedule('* * * * *', () => {
  checkAndGenerateDigests().catch(err => logger.error({ err }, 'Digest scheduler error'));
});
```

**验收**：设置一个用户的 schedule 为当前时间 +1 分钟，等待触发，检查 digests 表有新记录。

---

### D7. Digest API（列表/详情/手动触发）

**依赖**：D1
**目标**：提供 REST API 查看和手动生成 Digest

**操作步骤**：

创建 `packages/backend/src/routes/digests.ts`：

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/client.js';
import { digests } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';
import { generateDigest } from '../engine/digest/pipeline.js';

const digestRoutes = new Hono<{ Variables: AuthVariables }>();

digestRoutes.use('*', requireAuth);

// GET /me/digests — list user's digests
digestRoutes.get('/', async (c) => {
  const user = c.get('user');
  const limit = Number(c.req.query('limit') || '20');
  const tier = c.req.query('tier');

  let query = db.select().from(digests)
    .where(eq(digests.userId, user.id))
    .orderBy(desc(digests.createdAt))
    .limit(limit);

  const results = query.all();
  return c.json({ digests: results });
});

// GET /me/digests/latest — get latest digest
digestRoutes.get('/latest', async (c) => {
  const user = c.get('user');
  const tier = c.req.query('tier') || 'daily';

  const result = db.select().from(digests)
    .where(and(eq(digests.userId, user.id), eq(digests.tier, tier)))
    .orderBy(desc(digests.createdAt))
    .limit(1)
    .get();

  if (!result) return c.json({ error: 'No digest found' }, 404);
  return c.json(result);
});

// GET /me/digests/:id — get specific digest
digestRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const result = db.select().from(digests)
    .where(and(eq(digests.id, id), eq(digests.userId, user.id)))
    .get();

  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

// POST /me/digests/generate — manually trigger digest generation
digestRoutes.post('/generate', zValidator('json', z.object({
  tier: z.enum(['flash', 'daily', 'deep']),
  count: z.number().min(1).max(20).optional(),
})), async (c) => {
  const user = c.get('user');
  const { tier, count } = c.req.valid('json');

  const digest = await generateDigest(user.id, {
    tier,
    count: count || (tier === 'flash' ? 8 : tier === 'daily' ? 8 : 2),
  });

  return c.json(digest, 201);
});

export { digestRoutes };
```

挂载到 `index.ts`：
```typescript
import { digestRoutes } from './routes/digests.js';
app.route('/api/v1/me/digests', digestRoutes);
```

**验收**：
```bash
# 登录获取 cookie
curl -s -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@arclight.local","password":"test1234"}' \
  -c cookies.txt

# 手动生成 Flash digest
curl -s -X POST http://localhost:3000/api/v1/me/digests/generate \
  -H "Content-Type: application/json" \
  -d '{"tier":"flash"}' \
  -b cookies.txt | jq .tier
# 预期: "flash"

# 列出 digests
curl -s http://localhost:3000/api/v1/me/digests -b cookies.txt | jq '.digests | length'
# 预期: >= 1
```

---

## Phase E — 前端 Digest 阅读

### E1. Digest 历史列表页

**依赖**：D7
**目标**：展示用户的 Digest 历史

创建 `packages/frontend/src/pages/Digests.tsx`：

- 使用 TanStack Query 从 `/api/v1/me/digests` 获取列表
- 按日期分组展示，每条显示 tier 图标 + 日期 + 条目数
- 点击跳转到详情页

### E2. Digest 阅读页

**依赖**：E1
**目标**：渲染单个 Digest 内容

创建 `packages/frontend/src/pages/DigestView.tsx`：

- 从 `/api/v1/me/digests/:id` 获取详情
- 渲染 Markdown 内容（使用 `react-markdown` 或直接渲染 HTML）
- 展示 Context Injection 背景信息
- 每条 item 有"阅读原文"链接

### E3. 手动生成按钮

**依赖**：E1
**目标**：用户可以在前端手动触发 Digest 生成

在 Digests 页面顶部添加：
- "生成 Flash" / "生成 Daily" / "生成 Deep" 按钮
- 点击后调用 POST `/api/v1/me/digests/generate`
- loading 状态 + 成功后刷新列表

### E4. Dashboard 更新

**依赖**：E2
**目标**：Dashboard 显示最新 Digest

修改 `Dashboard.tsx`：
- 调用 `/api/v1/me/digests/latest` 获取最新 Daily digest
- 如果存在，渲染内容预览
- 如果不存在，显示"暂无 Digest，点击生成"
- 显示基础统计（总 items 数、总 sources 数）

**验收（Phase E 整体）**：
```
浏览器访问 http://localhost:5173
1. 登录 → Dashboard 显示最新 Digest 预览（或提示生成）
2. 点击侧边栏"Digests" → 看到历史列表
3. 点击"生成 Daily" → 等待生成 → 列表刷新出新 Digest
4. 点击新 Digest → 进入阅读页，看到渲染后的标题列表
```

---

## Git 工作流

每个 Phase 完成后 commit：

```bash
# Phase A 完成后
git add -A && git commit -m "feat(engine): RSS/Atom parser + Google News adapter"

# Phase B 完成后
git add -A && git commit -m "feat(engine): feed collection engine — fetch, normalize, dedup, schedule"

# Phase C 完成后
git add -A && git commit -m "feat(prefs): user preferences CRUD + topic/schedule config UI"

# Phase D 完成后
git add -A && git commit -m "feat(digest): digest pipeline — ranking, rendering, LLM context injection"

# Phase E 完成后
git add -A && git commit -m "feat(frontend): digest reading pages + dashboard update"

# 全部完成后 push
git push origin main
```

## 代码质量要求

- TypeScript strict mode，0 errors
- 关键函数有 JSDoc 注释
- 不要使用 `any` 类型（除非有明确理由并注释）
- pino logger 记录所有重要操作和错误
- `.github/workflows/ci.yml` 中的 typecheck 必须通过

## 总预估

| Phase | 预估工时 |
|-------|---------|
| A. RSS Adapter | 4h |
| B. Feed 采集引擎 | 12h |
| C. User Preferences | 8h |
| D. Digest 引擎 | 14h |
| E. 前端 Digest 阅读 | 6h |
| **合计** | **~44h** |

---

*Generated for ArcLight Milestone 2 — 2026-03-06*

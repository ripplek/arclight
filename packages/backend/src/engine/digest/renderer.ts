// packages/backend/src/engine/digest/renderer.ts
import type { RankedItem } from './ranking.js';
import type { EnhancedItem } from './ai-enhance.js';

export type DigestTier = 'flash' | 'daily' | 'deep' | 'weekly' | 'buzz' | 'alert';

export interface RenderOutput {
  markdown: string;
  html: string;
}

export function renderDigest(items: EnhancedItem[], tier: DigestTier, date: string): RenderOutput {
  // If items have AI enhancement, use enhanced renderers
  const hasEnhanced = items.some((i) => i.enhanced);

  switch (tier) {
    case 'flash':
      return renderFlash(items, date);
    case 'daily':
      return hasEnhanced ? renderDailyEnhanced(items, date) : renderDaily(items, date);
    case 'deep':
      return hasEnhanced ? renderDeepEnhanced(items, date) : renderDeep(items, date);
    default:
      return hasEnhanced ? renderDailyEnhanced(items, date) : renderDaily(items, date);
  }
}

// ── Flash: pure title list (no AI enhancement needed) ──

function renderFlash(items: EnhancedItem[], date: string): RenderOutput {
  const lines = items.map((item, i) => {
    const title = item.enhanced?.chineseTitle || item.title;
    return `${i + 1}. ${title}`;
  });

  const markdown = `# ⚡ 快讯 — ${date}\n\n${lines.join('\n')}\n`;

  const htmlItems = items.map((item) => {
    const title = item.enhanced?.chineseTitle || item.title;
    return `<li><a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(title)}</a></li>`;
  });

  const html = `<h1>⚡ 快讯 — ${date}</h1>\n<ol>\n${htmlItems.join('\n')}\n</ol>`;

  return { markdown, html };
}

// ── Daily Enhanced: grouped by category ──

function renderDailyEnhanced(items: EnhancedItem[], date: string): RenderOutput {
  // Group items by category
  const groups = groupByCategory(items);
  const mdSections: string[] = [];
  const htmlSections: string[] = [];
  let globalIdx = 1;

  for (const group of groups) {
    // Category header
    mdSections.push(`\n## ${group.emoji} ${group.category}\n`);
    htmlSections.push(`<h2>${group.emoji} ${escapeHtml(group.category)}</h2>`);

    for (const item of group.items) {
      const e = item.enhanced!;

      // Markdown
      let md = `**${globalIdx}. ${e.chineseTitle}**`;
      md += `\n${e.summary}`;
      if (e.context) {
        md += `\n📎 _${e.context}_`;
      }
      if (e.whyImportant) {
        md += `\n💡 ${e.whyImportant}`;
      }
      md += `\n🔗 [${truncate(item.title, 50)}](${item.url})`;
      if (item.topicMatches.length > 0) {
        md += ` · ${item.topicMatches.map((t) => `\`${t}\``).join(' ')}`;
      }
      md += '\n';
      mdSections.push(md);

      // HTML
      let html = `<div class="digest-item" style="margin-bottom:1.2em;padding:0.8em;border-left:3px solid #e0e0e0">`;
      html += `<div style="font-weight:600;font-size:1.05em">${globalIdx}. ${escapeHtml(e.chineseTitle)}</div>`;
      html += `<div style="color:#444;margin:0.3em 0">${escapeHtml(e.summary)}</div>`;
      if (e.context) {
        html += `<div style="color:#888;font-size:0.9em">📎 ${escapeHtml(e.context)}</div>`;
      }
      if (e.whyImportant) {
        html += `<div style="color:#b45309;font-size:0.9em">💡 ${escapeHtml(e.whyImportant)}</div>`;
      }
      html += `<div style="margin-top:0.3em;font-size:0.85em"><a href="${escapeHtml(item.url)}" target="_blank">🔗 ${escapeHtml(truncate(item.title, 60))}</a>`;
      if (item.topicMatches.length > 0) {
        html += ` · ${item.topicMatches.map((t) => `<span style="background:#f0f4ff;padding:1px 5px;border-radius:3px;font-size:0.85em">${escapeHtml(t)}</span>`).join(' ')}`;
      }
      html += `</div></div>`;
      htmlSections.push(html);

      globalIdx++;
    }
  }

  // Also render any items without enhancement at the end
  const unenhanced = items.filter((i) => !i.enhanced);
  if (unenhanced.length > 0) {
    mdSections.push(`\n## 📌 其他\n`);
    htmlSections.push(`<h2>📌 其他</h2>`);
    for (const item of unenhanced) {
      mdSections.push(`**${globalIdx}. ${item.title}**\n🔗 [阅读原文](${item.url})\n`);
      htmlSections.push(
        `<div class="digest-item"><strong>${globalIdx}. ${escapeHtml(item.title)}</strong><br/><a href="${escapeHtml(item.url)}">阅读原文</a></div>`,
      );
      globalIdx++;
    }
  }

  const itemCountInfo = `_共 ${items.length} 条精选，来自 ${countSources(items)} 个信源_\n`;
  const markdown = `# 📰 今日精选 — ${date}\n${itemCountInfo}\n${mdSections.join('\n')}\n`;
  const html = `<h1>📰 今日精选 — ${date}</h1>\n<p style="color:#888">${escapeHtml(itemCountInfo)}</p>\n${htmlSections.join('\n')}`;

  return { markdown, html };
}

// ── Deep Enhanced ──

function renderDeepEnhanced(items: EnhancedItem[], date: string): RenderOutput {
  const groups = groupByCategory(items);
  const mdSections: string[] = [];
  const htmlSections: string[] = [];
  let globalIdx = 1;

  for (const group of groups) {
    mdSections.push(`\n## ${group.emoji} ${group.category}\n`);
    htmlSections.push(`<h2>${group.emoji} ${escapeHtml(group.category)}</h2>`);

    for (const item of group.items) {
      const e = item.enhanced!;

      let md = `### ${globalIdx}. ${e.chineseTitle}\n\n`;
      md += `${e.summary}\n\n`;
      if (e.context) {
        md += `> 📎 **背景**：${e.context}\n\n`;
      }
      if (e.whyImportant) {
        md += `> 💡 **为什么重要**：${e.whyImportant}\n\n`;
      }
      if (item.content) {
        const snippet = item.content.slice(0, 500);
        md += `${snippet}${item.content.length > 500 ? '...' : ''}\n\n`;
      }
      md += `🔗 [${item.title}](${item.url})\n`;
      mdSections.push(md);

      let html = `<div class="digest-item-deep" style="margin-bottom:2em">`;
      html += `<h3>${globalIdx}. ${escapeHtml(e.chineseTitle)}</h3>`;
      html += `<p style="font-size:1.05em">${escapeHtml(e.summary)}</p>`;
      if (e.context) {
        html += `<blockquote style="border-left:3px solid #ddd;padding-left:1em;color:#555">📎 <strong>背景</strong>：${escapeHtml(e.context)}</blockquote>`;
      }
      if (e.whyImportant) {
        html += `<blockquote style="border-left:3px solid #f59e0b;padding-left:1em;color:#92400e">💡 <strong>为什么重要</strong>：${escapeHtml(e.whyImportant)}</blockquote>`;
      }
      html += `<p><a href="${escapeHtml(item.url)}" target="_blank">🔗 ${escapeHtml(item.title)}</a></p>`;
      html += `</div>`;
      htmlSections.push(html);

      globalIdx++;
    }
  }

  const markdown = `# 🔍 深度推荐 — ${date}\n\n${mdSections.join('\n---\n\n')}\n`;
  const html = `<h1>🔍 深度推荐 — ${date}</h1>\n${htmlSections.join('\n<hr/>\n')}`;

  return { markdown, html };
}

// ── Fallback renderers (no AI enhancement) ──

function renderDaily(items: EnhancedItem[], date: string): RenderOutput {
  const sections = items.map((item, i) => {
    const badge = tierBadge(item.tier);
    let md = `### ${i + 1}. ${badge} ${item.title}\n`;
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

  const htmlSections = items.map((item, i) => {
    const badge = tierBadge(item.tier);
    let section = `<div class="digest-item" style="margin-bottom:1.5em;padding-bottom:1.5em;border-bottom:1px solid #eee">`;
    section += `<h3>${i + 1}. ${badge} ${escapeHtml(item.title)}</h3>`;
    if (item.contextInjection) {
      section += `<p style="color:#666;font-size:0.9em">📎 ${escapeHtml(item.contextInjection)}</p>`;
    }
    if (item.topicMatches.length > 0) {
      section += `<p style="font-size:0.85em">🏷️ ${item.topicMatches.map((t) => `<span style="background:#f0f0f0;padding:2px 6px;border-radius:4px;margin-right:4px">${escapeHtml(t)}</span>`).join('')}</p>`;
    }
    section += `<p><a href="${escapeHtml(item.url)}" target="_blank">🔗 阅读原文</a></p>`;
    section += `</div>`;
    return section;
  });

  const html = `<h1>📰 今日精选 — ${date}</h1>\n${htmlSections.join('\n')}`;
  return { markdown, html };
}

function renderDeep(items: EnhancedItem[], date: string): RenderOutput {
  const sections = items.map((item, i) => {
    const badge = tierBadge(item.tier);
    let md = `## ${i + 1}. ${badge} ${item.title}\n\n`;
    if (item.contextInjection) {
      md += `> 📎 **背景**：${item.contextInjection}\n\n`;
    }
    if (item.content) {
      const summary = item.content.slice(0, 500);
      md += `${summary}${item.content.length > 500 ? '...' : ''}\n\n`;
    }
    md += `🔗 [阅读原文](${item.url})\n`;
    return md;
  });

  const markdown = `# 🔍 深度推荐 — ${date}\n\n${sections.join('\n---\n\n')}\n`;

  const htmlSections = items.map((item, i) => {
    const badge = tierBadge(item.tier);
    let section = `<div class="digest-item-deep" style="margin-bottom:2em">`;
    section += `<h2>${i + 1}. ${badge} ${escapeHtml(item.title)}</h2>`;
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

interface CategoryGroup {
  category: string;
  emoji: string;
  items: EnhancedItem[];
}

function groupByCategory(items: EnhancedItem[]): CategoryGroup[] {
  const map = new Map<string, { emoji: string; items: EnhancedItem[] }>();

  for (const item of items) {
    if (!item.enhanced) continue;
    const cat = item.enhanced.category;
    if (!map.has(cat)) {
      map.set(cat, { emoji: item.enhanced.categoryEmoji, items: [] });
    }
    map.get(cat)!.items.push(item);
  }

  // Sort groups by number of items (largest first), then alphabetically
  return Array.from(map.entries())
    .sort((a, b) => b[1].items.length - a[1].items.length || a[0].localeCompare(b[0]))
    .map(([category, { emoji, items }]) => ({ category, emoji, items }));
}

function countSources(items: EnhancedItem[]): number {
  return new Set(items.map((i) => i.sourceId)).size;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function tierBadge(tier: number): string {
  switch (tier) {
    case 1: return '🔴';
    case 2: return '🟠';
    case 3: return '🟡';
    case 4: return '🟢';
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

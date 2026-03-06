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

// ── Flash: pure title list ──

function renderFlash(items: RankedItem[], date: string): RenderOutput {
  const lines = items.map((item, i) => {
    const badge = tierBadge(item.tier);
    return `${i + 1}. ${badge} ${item.title}`;
  });

  const markdown = `# ⚡ Flash — ${date}\n\n${lines.join('\n')}\n`;

  const htmlItems = items.map((item, i) => {
    const badge = tierBadge(item.tier);
    return `<li>${badge} <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a></li>`;
  });

  const html = `<h1>⚡ Flash — ${date}</h1>\n<ol>\n${htmlItems.join('\n')}\n</ol>`;

  return { markdown, html };
}

// ── Daily: title + context + topic tags ──

function renderDaily(items: RankedItem[], date: string): RenderOutput {
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

// ── Deep: long summary + background + why important ──

function renderDeep(items: RankedItem[], date: string): RenderOutput {
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

    if (item.topicMatches.length > 0) {
      md += `🏷️ ${item.topicMatches.join(', ')}\n\n`;
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

import type {
  PushChannel,
  PushChannelType,
  ChannelConfig,
  TelegramChannelConfig,
  PushPayload,
  PushResult,
} from '../types.js';
import { logger } from '../../../shared/logger.js';

interface TelegramSendOptions {
  chat_id: string;
  text: string;
  parse_mode?: 'MarkdownV2' | 'HTML' | 'Markdown';
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_MIN_INTERVAL_MS = 50;

export class TelegramChannel implements PushChannel {
  readonly type: PushChannelType = 'telegram';
  private defaultBotToken: string;

  constructor(botToken: string) {
    this.defaultBotToken = botToken;
  }

  validateConfig(config: ChannelConfig): { valid: boolean; error?: string } {
    if (config.type !== 'telegram') {
      return { valid: false, error: 'Config type mismatch' };
    }

    const tg = config as TelegramChannelConfig;
    if (!tg.chatId || !/^-?\d+$/.test(tg.chatId)) {
      return { valid: false, error: 'Invalid chat_id format (must be numeric)' };
    }

    return { valid: true };
  }

  async send(config: ChannelConfig, payload: PushPayload): Promise<PushResult> {
    const start = Date.now();
    const tgConfig = config as TelegramChannelConfig;
    const botToken = tgConfig.botToken || this.defaultBotToken;

    try {
      const formattedContent = this.formatForTelegram(payload);
      const chunks = this.splitMessage(formattedContent, TELEGRAM_MAX_MESSAGE_LENGTH);
      let lastMessageId: number | undefined;

      for (let i = 0; i < chunks.length; i++) {
        const body: TelegramSendOptions = {
          chat_id: tgConfig.chatId,
          text: chunks[i],
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        };
        const response = await this.callTelegramApi(botToken, 'sendMessage', body);

        if (!response.ok) {
          const errData = response as TelegramErrorResponse;
          return {
            success: false,
            channelType: 'telegram',
            error: errData.description || 'Telegram API error',
            errorCode: String(errData.error_code),
            retryable: this.isRetryableError(errData.error_code),
            durationMs: Date.now() - start,
          };
        }

        lastMessageId = (response as TelegramSuccessResponse).result.message_id;

        if (i < chunks.length - 1) {
          await sleep(TELEGRAM_MIN_INTERVAL_MS);
        }
      }

      return {
        success: true,
        channelType: 'telegram',
        externalId: String(lastMessageId),
        retryable: false,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const error = err as Error;
      logger.error({ err: error, chatId: tgConfig.chatId }, 'Telegram send failed');
      return {
        success: false,
        channelType: 'telegram',
        error: error.message,
        retryable: true,
        durationMs: Date.now() - start,
      };
    }
  }

  async sendTest(config: ChannelConfig): Promise<PushResult> {
    const start = Date.now();
    const tgConfig = config as TelegramChannelConfig;
    const botToken = tgConfig.botToken || this.defaultBotToken;

    try {
      const response = await this.callTelegramApi(botToken, 'sendMessage', {
        chat_id: tgConfig.chatId,
        text:
          '✅ <b>ArcLight 推送测试</b>\n\n这条消息确认你的 Telegram 推送已正确配置。\n\n🕐 ' +
          new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        parse_mode: 'HTML',
      });

      if (!response.ok) {
        const errData = response as TelegramErrorResponse;
        return {
          success: false,
          channelType: 'telegram',
          error: errData.description || 'Telegram API error',
          errorCode: String(errData.error_code),
          retryable: false,
          durationMs: Date.now() - start,
        };
      }

      return {
        success: true,
        channelType: 'telegram',
        externalId: String((response as TelegramSuccessResponse).result.message_id),
        retryable: false,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        channelType: 'telegram',
        error: (err as Error).message,
        retryable: false,
        durationMs: Date.now() - start,
      };
    }
  }

  private formatForTelegram(payload: PushPayload): string {
    switch (payload.tier) {
      case 'flash':
        return this.formatFlash(payload);
      case 'daily':
        return this.formatDaily(payload);
      case 'deep':
        return this.formatDeep(payload);
      default:
        return this.formatDaily(payload);
    }
  }

  private formatFlash(payload: PushPayload): string {
    const lines = payload.contentMarkdown
      .split('\n')
      .filter((line) => /^\d+\./.test(line.trim()));

    let msg = `⚡ <b>快讯 — ${escapeHtml(payload.date)}</b>\n\n`;
    for (const line of lines) {
      msg += `${escapeHtml(line.trim())}\n`;
    }
    if (payload.webUrl) {
      msg += `\n🔗 <a href="${escapeHtml(payload.webUrl)}">在 ArcLight 中查看</a>`;
    }
    return msg;
  }

  private formatDaily(payload: PushPayload): string {
    let msg = `📰 <b>今日精选 — ${escapeHtml(payload.date)}</b>\n`;
    msg += `<i>共 ${payload.itemCount} 条精选</i>\n`;

    const sections = this.parseMarkdownSections(payload.contentMarkdown);

    for (const section of sections) {
      if (section.heading) {
        msg += `\n<b>${escapeHtml(section.heading)}</b>\n`;
      }

      for (const item of section.items) {
        msg += `\n• <b>${escapeHtml(item.title)}</b>`;

        const arcLine = this.renderArcLine(item, payload.webUrl, '  ');
        if (arcLine) {
          msg += `\n${arcLine}`;
        }
        if (item.summary) {
          msg += `\n  ${escapeHtml(item.summary)}`;
        }
        if (item.link) {
          const resolvedLink = this.resolveUrl(item.link, payload.webUrl) ?? item.link;
          msg += `\n  <a href="${escapeHtml(resolvedLink)}">🔗 原文</a>`;
        }
        msg += '\n';
      }
    }

    const serendipityBlock = this.formatSerendipity(payload.contentMarkdown, payload.webUrl);
    if (serendipityBlock) {
      msg += `\n${serendipityBlock}\n`;
    }

    if (payload.webUrl) {
      msg += `\n📱 <a href="${escapeHtml(payload.webUrl)}">在 ArcLight 中查看完整版</a>`;
    }
    return msg;
  }

  private formatDeep(payload: PushPayload): string {
    let msg = `🔍 <b>深度推荐 — ${escapeHtml(payload.date)}</b>\n`;

    const sections = this.parseMarkdownSections(payload.contentMarkdown);

    for (const section of sections) {
      if (section.heading) {
        msg += `\n<b>${escapeHtml(section.heading)}</b>\n`;
      }

      for (const item of section.items) {
        msg += `\n<b>${escapeHtml(item.title)}</b>\n`;

        const arcLine = this.renderArcLine(item, payload.webUrl);
        if (arcLine) {
          msg += `${arcLine}\n`;
        }
        if (item.summary) {
          msg += `${escapeHtml(item.summary)}\n`;
        }
        if (item.context) {
          msg += `📎 <i>${escapeHtml(item.context)}</i>\n`;
        }
        if (item.whyImportant) {
          msg += `💡 ${escapeHtml(item.whyImportant)}\n`;
        }
        if (item.link) {
          const resolvedLink = this.resolveUrl(item.link, payload.webUrl) ?? item.link;
          msg += `<a href="${escapeHtml(resolvedLink)}">🔗 阅读原文</a>\n`;
        }
        msg += '───\n';
      }
    }

    const serendipityBlock = this.formatSerendipity(payload.contentMarkdown, payload.webUrl);
    if (serendipityBlock) {
      msg += `\n${serendipityBlock}\n`;
    }

    if (payload.webUrl) {
      msg += `\n📱 <a href="${escapeHtml(payload.webUrl)}">在 ArcLight 中查看</a>`;
    }
    return msg;
  }

  private formatSerendipity(markdown: string, baseUrl?: string): string {
    // Look for the serendipity section: ## 🎲 意外发现
    const serendipityMatch = markdown.match(
      /## 🎲 意外发现\s*\n+\*\*(.+?)\*\*\s*\n+_(.+?)_\s*\n+🔗\s*\[.*?\]\(([^\)]+)\)/,
    );

    if (!serendipityMatch) {
      return '';
    }

    const [, title, reason, link] = serendipityMatch;
    const resolvedLink = this.resolveUrl(link, baseUrl) ?? link;

    let block = `<b>🎲 意外发现</b>\n\n`;
    block += `<b>${escapeHtml(title)}</b>\n`;
    block += `<i>${escapeHtml(reason)}</i>\n`;
    block += `<a href="${escapeHtml(resolvedLink)}">🔗 阅读原文</a>`;

    return block;
  }

  private parseMarkdownSections(markdown: string): ParsedSection[] {
    const sections: ParsedSection[] = [{ heading: '', items: [] }];
    let currentSection = sections[0];
    let currentItem: ParsedItem | null = null;

    for (const rawLine of markdown.split('\n')) {
      const line = rawLine.trim();
      if (!line || line === '---') {
        continue;
      }

      const titleMatch = line.match(/^(?:\*\*(\d+\.\s*.+)\*\*|#{2,3}\s*(\d+\.\s*.+))$/);
      if (titleMatch) {
        if (currentItem) currentSection.items.push(currentItem);
        currentItem = { title: this.stripInlineMarkdown(titleMatch[1] ?? titleMatch[2] ?? '') };
        continue;
      }

      const h2Match = line.match(/^##\s+(.+)/);
      if (h2Match) {
        if (currentItem) currentSection.items.push(currentItem);
        currentItem = null;
        currentSection = { heading: h2Match[1].trim(), items: [] };
        sections.push(currentSection);
        continue;
      }

      if (!currentItem) {
        continue;
      }

      const linkMatch = line.match(/🔗\s*\[.*?\]\(([^\)]+)\)/);
      if (linkMatch) {
        currentItem.link = linkMatch[1].trim();
        continue;
      }

      const arc = this.parseArcLine(line);
      if (arc) {
        currentItem.arc = arc;
        continue;
      }

      const normalizedLine = this.stripQuotePrefix(line);
      const contextMatch = normalizedLine.match(/^📎\s*(.+)$/);
      if (contextMatch) {
        currentItem.context = this.cleanLabelledText(contextMatch[1], '背景');
        continue;
      }

      const whyMatch = normalizedLine.match(/^💡\s*(.+)$/);
      if (whyMatch) {
        currentItem.whyImportant = this.cleanLabelledText(whyMatch[1], '为什么重要');
        continue;
      }

      if (normalizedLine.startsWith('🏷️')) {
        continue;
      }

      if (!normalizedLine.startsWith('#') && !normalizedLine.startsWith('_') && !currentItem.summary) {
        currentItem.summary = this.stripInlineMarkdown(normalizedLine);
      }
    }

    if (currentItem) currentSection.items.push(currentItem);

    return sections.filter((section, index) => section.heading || section.items.length > 0 || index === 0);
  }

  private parseArcLine(line: string): ParsedArc | null {
    const normalizedLine = this.stripQuotePrefix(line);
    if (!normalizedLine.startsWith('🧵')) {
      return null;
    }

    let content = normalizedLine.replace(/^🧵\s*/, '');
    content = content.replace(/^\*\*故事线\*\*：/, '');
    content = content.replace(/^故事线：/, '');

    const { text, link } = this.extractFirstMarkdownLink(content);
    const [titlePart, ...rest] = text.split(/\s+·\s+/);
    const title = this.stripInlineMarkdown(titlePart);

    if (!title) {
      return null;
    }

    return {
      title,
      link,
      summary: rest.length > 0 ? this.stripInlineMarkdown(rest.join(' · ')) : undefined,
    };
  }

  private renderArcLine(item: ParsedItem, baseUrl?: string, indent = ''): string {
    if (!item.arc?.title) {
      return '';
    }

    const resolvedArcLink = item.arc.link ? this.resolveUrl(item.arc.link, baseUrl) : undefined;
    const arcTitle = resolvedArcLink
      ? `<a href="${escapeHtml(resolvedArcLink)}">${escapeHtml(item.arc.title)}</a>`
      : escapeHtml(item.arc.title);
    const detail = item.arc.summary ? ` · ${escapeHtml(item.arc.summary)}` : '';

    return `${indent}📖 ${arcTitle}${detail}`;
  }

  private cleanLabelledText(text: string, label: string): string {
    const cleaned = this.stripInlineMarkdown(text);
    return cleaned.replace(new RegExp(`^${label}：\\s*`), '').trim();
  }

  private stripQuotePrefix(text: string): string {
    return text.replace(/^>\s*/, '').trim();
  }

  private stripInlineMarkdown(text: string): string {
    return text
      .replace(/\[(.*?)\]\(([^\)]+)\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim();
  }

  private extractFirstMarkdownLink(text: string): { text: string; link?: string } {
    const linkMatch = text.match(/^\[(.*?)\]\(([^\)]+)\)(.*)$/);
    if (linkMatch) {
      return {
        text: `${linkMatch[1]}${linkMatch[3]}`.trim(),
        link: linkMatch[2].trim(),
      };
    }

    return { text };
  }

  private resolveUrl(url: string, baseUrl?: string): string | undefined {
    try {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return new URL(url).toString();
      }
      if (!baseUrl) {
        return undefined;
      }
      return new URL(url, new URL(baseUrl).origin).toString();
    } catch {
      return undefined;
    }
  }

  private splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;
    let partNum = 1;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      let splitAt = maxLen;

      const doubleNewline = remaining.lastIndexOf('\n\n', maxLen - 50);
      if (doubleNewline > maxLen * 0.5) {
        splitAt = doubleNewline;
      } else {
        const singleNewline = remaining.lastIndexOf('\n', maxLen - 10);
        if (singleNewline > maxLen * 0.3) {
          splitAt = singleNewline;
        }
      }

      const chunk = remaining.slice(0, splitAt).trimEnd();
      const totalParts = Math.ceil(text.length / maxLen) + 1;
      chunks.push(`${chunk}\n\n<i>📄 (${partNum}/${totalParts})</i>`);
      remaining = remaining.slice(splitAt).trimStart();
      partNum++;
    }

    return chunks;
  }

  private async callTelegramApi(
    botToken: string,
    method: string,
    body: TelegramSendOptions | Record<string, unknown>,
  ): Promise<TelegramApiResponse> {
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return (await res.json()) as TelegramApiResponse;
  }

  private isRetryableError(errorCode: number): boolean {
    return errorCode === 429 || errorCode >= 500;
  }
}

interface ParsedSection {
  heading: string;
  items: ParsedItem[];
}

interface ParsedItem {
  title: string;
  summary?: string;
  context?: string;
  whyImportant?: string;
  link?: string;
  arc?: ParsedArc;
}

interface ParsedArc {
  title: string;
  summary?: string;
  link?: string;
}

type TelegramApiResponse = TelegramSuccessResponse | TelegramErrorResponse;

interface TelegramSuccessResponse {
  ok: true;
  result: { message_id: number; chat: { id: number } };
}

interface TelegramErrorResponse {
  ok: false;
  error_code: number;
  description: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

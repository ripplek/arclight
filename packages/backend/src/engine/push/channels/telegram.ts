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
        if (item.summary) {
          msg += `\n  ${escapeHtml(item.summary)}`;
        }
        if (item.link) {
          msg += `\n  <a href="${escapeHtml(item.link)}">🔗 原文</a>`;
        }
        msg += '\n';
      }
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
          msg += `<a href="${escapeHtml(item.link)}">🔗 阅读原文</a>\n`;
        }
        msg += '───\n';
      }
    }

    if (payload.webUrl) {
      msg += `\n📱 <a href="${escapeHtml(payload.webUrl)}">在 ArcLight 中查看</a>`;
    }
    return msg;
  }

  private parseMarkdownSections(markdown: string): ParsedSection[] {
    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let currentItem: ParsedItem | null = null;

    for (const line of markdown.split('\n')) {
      const h2Match = line.match(/^##\s+(.+)/);
      if (h2Match) {
        if (currentItem && currentSection) currentSection.items.push(currentItem);
        currentItem = null;
        currentSection = { heading: h2Match[1].trim(), items: [] };
        sections.push(currentSection);
        continue;
      }

      const titleMatch = line.match(/^(?:\*\*|\#{3}\s*)(\d+\.\s*.+?)(?:\*\*)?$/);
      if (titleMatch && currentSection) {
        if (currentItem) currentSection.items.push(currentItem);
        currentItem = { title: titleMatch[1].trim() };
        continue;
      }

      const linkMatch = line.match(/🔗\s*\[.*?\]\((https?:\/\/[^\)]+)\)/);
      if (linkMatch && currentItem) {
        currentItem.link = linkMatch[1];
        continue;
      }

      const contextMatch = line.match(/📎\s*(?:_)?(.+?)(?:_)?$/);
      if (contextMatch && currentItem) {
        currentItem.context = contextMatch[1].trim();
        continue;
      }

      const whyMatch = line.match(/💡\s*(.+)/);
      if (whyMatch && currentItem) {
        currentItem.whyImportant = whyMatch[1].trim();
        continue;
      }

      if (currentItem && line.trim() && !line.startsWith('#') && !line.startsWith('_')) {
        if (!currentItem.summary) {
          currentItem.summary = line.trim();
        }
      }
    }

    if (currentItem && currentSection) currentSection.items.push(currentItem);

    if (sections.length === 0) {
      sections.push({ heading: '', items: [] });
    }

    return sections;
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

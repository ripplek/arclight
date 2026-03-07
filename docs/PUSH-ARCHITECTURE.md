# ArcLight Push Architecture — 完整技术方案

> **Author**: System Architect (Opus)
> **Date**: 2026-03-07
> **Status**: Design Complete — Ready for Implementation
> **Milestone**: 3 / Phase 1

---

## Table of Contents

1. [概览](#1-概览)
2. [推送通道抽象层](#2-推送通道抽象层)
3. [Telegram Bot 推送方案](#3-telegram-bot-推送方案)
4. [Email 推送方案](#4-email-推送方案)
5. [Webhook 推送方案](#5-webhook-推送方案)
6. [推送状态管理](#6-推送状态管理)
7. [推送调度](#7-推送调度)
8. [API 端点](#8-api-端点)
9. [数据库变更](#9-数据库变更)
10. [文件结构](#10-文件结构)
11. [MVP 优先级](#11-mvp-优先级)
12. [附录：Telegram MarkdownV2 转义](#附录atelegram-markdownv2-转义)
13. [附录：Email HTML 模板](#附录bemail-html-模板)

---

## 1. 概览

### 架构目标

- **可扩展**：新增推送通道只需实现一个 interface，注册即可使用
- **可靠**：失败重试 + 状态追踪 + 推送日志
- **用户友好**：支持 quiet hours、测试推送、绑定/解绑流程
- **与现有系统低耦合**：推送引擎独立于 Digest 生成 pipeline

### 数据流

```
Digest Pipeline (generate) 
  → digests 表 (pushStatus: 'pending')
  → Push Dispatcher (checkAndPushDigests job)
    → 读取 user pushChannels 配置
    → 对每个 enabled channel 调用 PushChannel.send()
    → 写入 push_logs 表
    → 更新 digests.pushStatus
```

---

## 2. 推送通道抽象层

### 2.1 核心 Interface

```typescript
// packages/backend/src/engine/push/types.ts

/** 推送通道类型标识 */
export type PushChannelType = 'telegram' | 'email' | 'webhook';
// 未来扩展: | 'wechat' | 'slack' | 'discord'

/** 推送通道配置 — 每种通道的特定配置 */
export interface TelegramChannelConfig {
  type: 'telegram';
  chatId: string;
  /** 可选：用户自带 bot token（多租户场景），默认用系统 bot */
  botToken?: string;
  /** 绑定方式 */
  bindMethod?: 'manual' | 'bot_start';
  /** 绑定时间 */
  boundAt?: string;
}

export interface EmailChannelConfig {
  type: 'email';
  address: string;
  /** 是否已验证（防止滥用） */
  verified: boolean;
  /** 验证码（内部使用） */
  verificationToken?: string;
}

export interface WebhookChannelConfig {
  type: 'webhook';
  url: string;
  /** 可选：自定义 headers（如 Authorization） */
  headers?: Record<string, string>;
  /** 签名密钥（HMAC-SHA256） */
  secret?: string;
}

export type ChannelConfig = TelegramChannelConfig | EmailChannelConfig | WebhookChannelConfig;

/** 推送内容 — 从 digest 提取 */
export interface PushPayload {
  digestId: string;
  userId: string;
  tier: 'flash' | 'daily' | 'deep' | 'weekly' | 'buzz' | 'alert';
  date: string;
  /** Markdown 格式内容 */
  contentMarkdown: string;
  /** HTML 格式内容 */
  contentHtml: string;
  /** 摘要/标题（用于通知预览） */
  title: string;
  /** 条目数量 */
  itemCount: number;
  /** 前端查看链接 */
  webUrl?: string;
}

/** 推送结果 */
export interface PushResult {
  success: boolean;
  /** 通道类型 */
  channelType: PushChannelType;
  /** 通道返回的消息 ID（Telegram message_id / Email message-id） */
  externalId?: string;
  /** 错误信息 */
  error?: string;
  /** 错误代码（用于重试判断） */
  errorCode?: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 发送耗时 ms */
  durationMs: number;
}

/** 推送通道接口 — 所有通道必须实现 */
export interface PushChannel {
  /** 通道类型标识 */
  readonly type: PushChannelType;

  /** 
   * 发送推送
   * @param config 该通道的配置
   * @param payload 推送内容
   * @returns 推送结果
   */
  send(config: ChannelConfig, payload: PushPayload): Promise<PushResult>;

  /**
   * 验证配置是否有效（如 Telegram chatId 格式、email 格式）
   */
  validateConfig(config: ChannelConfig): { valid: boolean; error?: string };

  /**
   * 发送测试消息（用户配置时验证通道可用性）
   */
  sendTest(config: ChannelConfig): Promise<PushResult>;
}
```

### 2.2 通道注册/发现机制

```typescript
// packages/backend/src/engine/push/registry.ts

import type { PushChannel, PushChannelType } from './types.js';

class PushChannelRegistry {
  private channels = new Map<PushChannelType, PushChannel>();

  /** 注册一个推送通道 */
  register(channel: PushChannel): void {
    this.channels.set(channel.type, channel);
  }

  /** 获取指定通道 */
  get(type: PushChannelType): PushChannel | undefined {
    return this.channels.get(type);
  }

  /** 获取所有已注册通道 */
  getAll(): PushChannel[] {
    return Array.from(this.channels.values());
  }

  /** 检查通道是否已注册 */
  has(type: PushChannelType): boolean {
    return this.channels.has(type);
  }

  /** 列出所有已注册通道类型 */
  listTypes(): PushChannelType[] {
    return Array.from(this.channels.keys());
  }
}

// 单例
export const pushRegistry = new PushChannelRegistry();
```

### 2.3 通道初始化

```typescript
// packages/backend/src/engine/push/index.ts

import { pushRegistry } from './registry.js';
import { TelegramChannel } from './channels/telegram.js';
import { EmailChannel } from './channels/email.js';
import { WebhookChannel } from './channels/webhook.js';
import { logger } from '../../shared/logger.js';

/**
 * 初始化所有推送通道（在 server 启动时调用）
 */
export function initPushChannels(): void {
  // Telegram — 需要 TELEGRAM_BOT_TOKEN 环境变量
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    pushRegistry.register(new TelegramChannel(telegramToken));
    logger.info('Push channel registered: telegram');
  } else {
    logger.warn('TELEGRAM_BOT_TOKEN not set, telegram push disabled');
  }

  // Email — 需要 SMTP 或 Resend 配置
  const resendApiKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  if (resendApiKey) {
    pushRegistry.register(new EmailChannel({ provider: 'resend', apiKey: resendApiKey }));
    logger.info('Push channel registered: email (resend)');
  } else if (smtpHost) {
    pushRegistry.register(new EmailChannel({
      provider: 'smtp',
      host: smtpHost,
      port: Number(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || 'ArcLight <noreply@arclight.app>',
    }));
    logger.info('Push channel registered: email (smtp)');
  }

  // Webhook — 始终可用
  pushRegistry.register(new WebhookChannel());
  logger.info('Push channel registered: webhook');

  logger.info({ channels: pushRegistry.listTypes() }, 'Push channels initialized');
}

export { pushRegistry } from './registry.js';
export { PushDispatcher } from './dispatcher.js';
export type * from './types.js';
```

---

## 3. Telegram Bot 推送方案

### 3.1 Bot 创建和 Token 管理

**创建流程**：
1. 在 Telegram 中找到 @BotFather
2. 发送 `/newbot`，设置名称为 `ArcLight News` 或类似
3. 获取 Bot Token，存入 `.env` 文件

```bash
# .env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ
# 可选：Webhook URL（用于 /start 绑定模式）
TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/v1/push/telegram/webhook
```

**安全注意**：
- Token 仅存在环境变量中，不入数据库
- 用户自带 bot token 场景下，token 加密存储（AES-256，密钥来自环境变量 `ENCRYPTION_KEY`）
- MVP 阶段仅支持单一系统 Bot

### 3.2 用户绑定流程

#### 方式 A：前端手动输入 chat_id（MVP ✅）

用户操作：
1. 在 ArcLight 前端 Settings → Push Channels → Telegram
2. 找到系统 Bot（显示 Bot 用户名，如 `@ArcLightNewsBot`）
3. 用户需要先在 Telegram 中给 Bot 发一条消息（Telegram 要求 Bot 只能回复已主动发送过消息的用户）
4. 输入自己的 Telegram chat_id（前端提示如何获取：给 @userinfobot 发消息）
5. 点击"发送测试消息"验证
6. 保存配置

```typescript
// 前端配置结构
interface TelegramBindingForm {
  chatId: string;    // 用户输入的 chat_id
  testSent: boolean; // 是否已发送测试
}
```

#### 方式 B：Bot /start 命令自动绑定（延后 🟡）

用户操作：
1. 前端生成一个绑定链接：`https://t.me/ArcLightNewsBot?start=BIND_TOKEN`
2. 用户点击链接，在 Telegram 中打开 Bot
3. 用户发送 `/start BIND_TOKEN`
4. Bot 收到消息，通过 BIND_TOKEN 查找对应的 ArcLight 用户
5. 自动将 `message.chat.id` 绑定到该用户的 pushChannels.telegram

```typescript
// packages/backend/src/engine/push/channels/telegram-webhook.ts

import { Hono } from 'hono';
import { db } from '../../../db/client.js';
import { userPreferences } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../../../shared/logger.js';

// 临时存储 bind token → userId 映射（也可以用 DB 的 verification 表）
const pendingBindings = new Map<string, { userId: string; expiresAt: number }>();

/** 生成绑定 token */
export function createBindToken(userId: string): string {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  pendingBindings.set(token, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 分钟过期
  });
  return token;
}

/** 处理 Telegram Webhook 更新 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (!update.message?.text) return;

  const chatId = String(update.message.chat.id);
  const text = update.message.text.trim();

  // /start BIND_TOKEN
  if (text.startsWith('/start ')) {
    const token = text.slice(7).trim();
    const binding = pendingBindings.get(token);
    
    if (!binding || binding.expiresAt < Date.now()) {
      await sendTelegramMessage(chatId, '❌ 绑定链接已过期，请在 ArcLight 中重新生成。');
      pendingBindings.delete(token);
      return;
    }

    // 绑定 chatId 到用户
    const prefs = await db.select().from(userPreferences)
      .where(eq(userPreferences.userId, binding.userId))
      .get();

    if (prefs) {
      const pushChannels = (prefs.pushChannels as Record<string, unknown>) || {};
      pushChannels.telegram = {
        type: 'telegram',
        enabled: true,
        chatId,
        bindMethod: 'bot_start',
        boundAt: new Date().toISOString(),
      };
      await db.update(userPreferences)
        .set({ pushChannels, updatedAt: new Date() })
        .where(eq(userPreferences.userId, binding.userId));
    }

    pendingBindings.delete(token);
    await sendTelegramMessage(chatId, '✅ 绑定成功！你将在此接收 ArcLight 新闻推送。');
    logger.info({ userId: binding.userId, chatId }, 'Telegram binding via /start');
    return;
  }

  // /start（无 token）— 欢迎消息
  if (text === '/start') {
    await sendTelegramMessage(chatId, 
      '👋 欢迎使用 ArcLight 新闻推送！\n\n' +
      '请在 ArcLight 网页端完成绑定设置。\n' +
      `你的 Chat ID: \`${chatId}\``,
    );
    return;
  }

  // /status — 查看绑定状态
  if (text === '/status') {
    // 查找是否有用户绑定了这个 chatId
    await sendTelegramMessage(chatId, `📊 Chat ID: \`${chatId}\`\n使用此 ID 在 ArcLight 中配置推送。`);
    return;
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
    from?: { id: number; first_name: string };
  };
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}
```

### 3.3 Telegram Channel 实现

```typescript
// packages/backend/src/engine/push/channels/telegram.ts

import type {
  PushChannel,
  PushChannelType,
  ChannelConfig,
  TelegramChannelConfig,
  PushPayload,
  PushResult,
} from '../types.js';
import { logger } from '../../../shared/logger.js';

/** Telegram 消息格式配置 */
interface TelegramSendOptions {
  chat_id: string;
  text: string;
  parse_mode?: 'MarkdownV2' | 'HTML' | 'Markdown';
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

/** Telegram API 限制 */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_MIN_INTERVAL_MS = 50; // 单聊每秒约 30 条

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
      // 根据 tier 选择格式化策略
      const formattedContent = this.formatForTelegram(payload);
      
      // 长消息分段发送
      const chunks = this.splitMessage(formattedContent, TELEGRAM_MAX_MESSAGE_LENGTH);
      let lastMessageId: number | undefined;

      for (let i = 0; i < chunks.length; i++) {
        const response = await this.callTelegramApi(botToken, 'sendMessage', {
          chat_id: tgConfig.chatId,
          text: chunks[i],
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });

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

        // 多段之间加延迟，避免触发频率限制
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
        retryable: true, // 网络错误可重试
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
        text: '✅ <b>ArcLight 推送测试</b>\n\n这条消息确认你的 Telegram 推送已正确配置。\n\n🕐 ' +
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

  // ── 格式化 ──

  /**
   * 将 digest 内容格式化为 Telegram HTML
   * 选择 HTML 而非 MarkdownV2 — 因为 MarkdownV2 转义太痛苦
   */
  private formatForTelegram(payload: PushPayload): string {
    const { tier, date, contentHtml, title, itemCount, webUrl } = payload;

    // Telegram HTML 支持的标签有限: <b>, <i>, <u>, <s>, <a>, <code>, <pre>
    // 需要将 renderer 输出的完整 HTML 简化为 Telegram 兼容格式

    switch (tier) {
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
    // Flash 格式：纯标题列表，从 markdown 解析更简单
    const lines = payload.contentMarkdown
      .split('\n')
      .filter(line => /^\d+\./.test(line.trim()));

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
    // Daily 格式：按分类分组，每条新闻带标题 + 摘要 + 链接
    // 从 markdown 解析结构化内容
    let msg = `📰 <b>今日精选 — ${escapeHtml(payload.date)}</b>\n`;
    msg += `<i>共 ${payload.itemCount} 条精选</i>\n`;

    // 解析 markdown 中的结构
    const sections = this.parseMarkdownSections(payload.contentMarkdown);
    
    for (const section of sections) {
      msg += `\n<b>${escapeHtml(section.heading)}</b>\n`;
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
      msg += `\n<b>${escapeHtml(section.heading)}</b>\n`;
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

  /** 简单解析 markdown 提取结构 */
  private parseMarkdownSections(markdown: string): ParsedSection[] {
    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let currentItem: ParsedItem | null = null;

    for (const line of markdown.split('\n')) {
      // ## 分类标题
      const h2Match = line.match(/^##\s+(.+)/);
      if (h2Match) {
        if (currentItem && currentSection) currentSection.items.push(currentItem);
        currentItem = null;
        currentSection = { heading: h2Match[1].trim(), items: [] };
        sections.push(currentSection);
        continue;
      }

      // **N. 标题**  or  ### N. 标题
      const titleMatch = line.match(/^(?:\*\*|\#{3}\s*)(\d+\.\s*.+?)(?:\*\*)?$/);
      if (titleMatch && currentSection) {
        if (currentItem) currentSection.items.push(currentItem);
        currentItem = { title: titleMatch[1].trim() };
        continue;
      }

      // 🔗 [text](url)
      const linkMatch = line.match(/🔗\s*\[.*?\]\((https?:\/\/[^\)]+)\)/);
      if (linkMatch && currentItem) {
        currentItem.link = linkMatch[1];
        continue;
      }

      // 📎 context
      const contextMatch = line.match(/📎\s*(?:_)?(.+?)(?:_)?$/);
      if (contextMatch && currentItem) {
        currentItem.context = contextMatch[1].trim();
        continue;
      }

      // 💡 why important
      const whyMatch = line.match(/💡\s*(.+)/);
      if (whyMatch && currentItem) {
        currentItem.whyImportant = whyMatch[1].trim();
        continue;
      }

      // 普通文本行 → summary
      if (currentItem && line.trim() && !line.startsWith('#') && !line.startsWith('_')) {
        if (!currentItem.summary) {
          currentItem.summary = line.trim();
        }
      }
    }

    // Flush last item
    if (currentItem && currentSection) currentSection.items.push(currentItem);

    // 如果没有解析到任何 section（如 flash 格式），创建一个默认 section
    if (sections.length === 0) {
      sections.push({ heading: '', items: [] });
    }

    return sections;
  }

  // ── 消息分段 ──

  /**
   * 将长消息按 Telegram 限制分段
   * 策略：优先在换行符处分割，保证每段是完整的内容块
   */
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

      // 找到一个合适的分割点（换行符、段落分隔）
      let splitAt = maxLen;
      
      // 优先在双换行处分割（段落边界）
      const doubleNewline = remaining.lastIndexOf('\n\n', maxLen - 50);
      if (doubleNewline > maxLen * 0.5) {
        splitAt = doubleNewline;
      } else {
        // 其次在单换行处分割
        const singleNewline = remaining.lastIndexOf('\n', maxLen - 10);
        if (singleNewline > maxLen * 0.3) {
          splitAt = singleNewline;
        }
      }

      const chunk = remaining.slice(0, splitAt).trimEnd();
      const totalParts = Math.ceil(text.length / maxLen) + 1;
      chunks.push(chunk + `\n\n<i>📄 (${partNum}/${totalParts})</i>`);
      remaining = remaining.slice(splitAt).trimStart();
      partNum++;
    }

    return chunks;
  }

  // ── Telegram API 调用 ──

  private async callTelegramApi(
    botToken: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<TelegramApiResponse> {
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as TelegramApiResponse;
  }

  /** 判断 Telegram 错误是否可重试 */
  private isRetryableError(errorCode: number): boolean {
    // 429: Rate limit → 可重试
    // 500+: Server error → 可重试
    // 400: Bad request → 不可重试（配置错误）
    // 403: Forbidden → 不可重试（被用户 block）
    // 404: Not found → 不可重试
    return errorCode === 429 || errorCode >= 500;
  }
}

// ── 辅助类型 ──

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

/** HTML 转义（Telegram HTML 模式） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 3.4 发送频率限制

Telegram Bot API 限制：
- 同一聊天：每秒不超过 1 条消息
- 所有聊天总计：每秒不超过 30 条消息
- 群组：每分钟 20 条

```typescript
// packages/backend/src/engine/push/rate-limiter.ts

/**
 * 简单的令牌桶限流器
 * MVP 使用内存实现，多实例场景需升级为 Redis
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRatePerSec: number;

  constructor(maxTokens: number, refillRatePerSec: number) {
    this.maxTokens = maxTokens;
    this.refillRatePerSec = refillRatePerSec;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    // 等待直到有 token 可用
    const waitMs = (1 / this.refillRatePerSec) * 1000;
    await new Promise(resolve => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerSec);
    this.lastRefill = now;
  }
}

// 全局限流器：Telegram 总限制 30/sec，留余量用 25
export const telegramRateLimiter = new RateLimiter(25, 25);
```

---

## 4. Email 推送方案

### 4.1 推荐方案

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **Resend** | API 简洁、deliverability 好、有 React Email 集成 | 需要验证域名、免费额度 3000/月 | ⭐⭐⭐ MVP 推荐 |
| nodemailer + SMTP | 灵活、可用任意 SMTP | 需要自管 SMTP、deliverability 自己保证 | ⭐⭐ 备选 |
| AWS SES | 便宜、规模化 | 配置复杂 | ⭐ 延后 |

**MVP 推荐：Resend**（免费额度足够初期使用，API 体验好）

### 4.2 Email Channel 实现

```typescript
// packages/backend/src/engine/push/channels/email.ts

import type {
  PushChannel,
  PushChannelType,
  ChannelConfig,
  EmailChannelConfig,
  PushPayload,
  PushResult,
} from '../types.js';
import { logger } from '../../../shared/logger.js';

interface ResendConfig {
  provider: 'resend';
  apiKey: string;
  from?: string;
}

interface SmtpConfig {
  provider: 'smtp';
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

type EmailProviderConfig = ResendConfig | SmtpConfig;

export class EmailChannel implements PushChannel {
  readonly type: PushChannelType = 'email';
  private config: EmailProviderConfig;

  constructor(config: EmailProviderConfig) {
    this.config = config;
  }

  validateConfig(config: ChannelConfig): { valid: boolean; error?: string } {
    if (config.type !== 'email') {
      return { valid: false, error: 'Config type mismatch' };
    }
    const email = config as EmailChannelConfig;
    if (!email.address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.address)) {
      return { valid: false, error: 'Invalid email address' };
    }
    return { valid: true };
  }

  async send(config: ChannelConfig, payload: PushPayload): Promise<PushResult> {
    const start = Date.now();
    const emailConfig = config as EmailChannelConfig;

    try {
      const subject = this.getSubject(payload);
      const html = this.wrapEmailTemplate(payload);

      if (this.config.provider === 'resend') {
        return await this.sendViaResend(emailConfig.address, subject, html, start);
      } else {
        return await this.sendViaSmtp(emailConfig.address, subject, html, start);
      }
    } catch (err) {
      logger.error({ err, to: emailConfig.address }, 'Email send failed');
      return {
        success: false,
        channelType: 'email',
        error: (err as Error).message,
        retryable: true,
        durationMs: Date.now() - start,
      };
    }
  }

  async sendTest(config: ChannelConfig): Promise<PushResult> {
    const start = Date.now();
    const emailConfig = config as EmailChannelConfig;

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#1a1a1a">✅ ArcLight 邮件推送测试</h1>
        <p>这封邮件确认你的邮箱推送已正确配置。</p>
        <p style="color:#666;font-size:0.9em">发送时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
      </div>
    `;

    try {
      if (this.config.provider === 'resend') {
        return await this.sendViaResend(emailConfig.address, 'ArcLight 推送测试', html, start);
      } else {
        return await this.sendViaSmtp(emailConfig.address, 'ArcLight 推送测试', html, start);
      }
    } catch (err) {
      return {
        success: false,
        channelType: 'email',
        error: (err as Error).message,
        retryable: false,
        durationMs: Date.now() - start,
      };
    }
  }

  // ── Resend 发送 ──

  private async sendViaResend(
    to: string,
    subject: string,
    html: string,
    start: number,
  ): Promise<PushResult> {
    const resendConfig = this.config as ResendConfig;
    const from = resendConfig.from || 'ArcLight <noreply@arclight.app>';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendConfig.apiKey}`,
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });

    const data = (await res.json()) as { id?: string; message?: string };

    if (!res.ok) {
      return {
        success: false,
        channelType: 'email',
        error: data.message || `HTTP ${res.status}`,
        errorCode: String(res.status),
        retryable: res.status >= 500 || res.status === 429,
        durationMs: Date.now() - start,
      };
    }

    return {
      success: true,
      channelType: 'email',
      externalId: data.id,
      retryable: false,
      durationMs: Date.now() - start,
    };
  }

  // ── SMTP 发送（使用 nodemailer） ──

  private async sendViaSmtp(
    to: string,
    subject: string,
    html: string,
    start: number,
  ): Promise<PushResult> {
    const smtpConfig = this.config as SmtpConfig;

    // 动态 import nodemailer（仅在使用 SMTP 时需要）
    const { createTransport } = await import('nodemailer');
    const transporter = createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.port === 465,
      auth: { user: smtpConfig.user, pass: smtpConfig.pass },
    });

    const info = await transporter.sendMail({
      from: smtpConfig.from,
      to,
      subject,
      html,
    });

    return {
      success: true,
      channelType: 'email',
      externalId: info.messageId,
      retryable: false,
      durationMs: Date.now() - start,
    };
  }

  // ── 邮件格式化 ──

  private getSubject(payload: PushPayload): string {
    const tierEmoji: Record<string, string> = {
      flash: '⚡', daily: '📰', deep: '🔍',
      weekly: '📋', buzz: '🔥', alert: '🚨',
    };
    const emoji = tierEmoji[payload.tier] || '📰';
    return `${emoji} ArcLight ${payload.title} — ${payload.date}`;
  }

  /** 将 digest HTML 内容包裹在邮件模板中 */
  private wrapEmailTemplate(payload: PushPayload): string {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${this.getSubject(payload)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:24px 30px">
              <h1 style="margin:0;font-size:20px;font-weight:600">ArcLight</h1>
              <p style="margin:4px 0 0;font-size:13px;opacity:0.8">${payload.title} · ${payload.date}</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:24px 30px;color:#333;line-height:1.6;font-size:15px">
              ${payload.contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 30px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#999">
              <p style="margin:0">
                ${payload.webUrl ? `<a href="${payload.webUrl}" style="color:#4a90d9">在 ArcLight 中查看</a> · ` : ''}
                <a href="#" style="color:#999">管理推送设置</a>
              </p>
              <p style="margin:4px 0 0">ArcLight — 你的智能新闻助手</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
```

### 4.3 配置项

```bash
# .env — Email 配置（二选一）

# 方案 A: Resend (推荐)
RESEND_API_KEY=re_xxxxxxxxxx
EMAIL_FROM="ArcLight <noreply@arclight.app>"

# 方案 B: SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=app-specific-password
SMTP_FROM="ArcLight <your@gmail.com>"
```

---

## 5. Webhook 推送方案

```typescript
// packages/backend/src/engine/push/channels/webhook.ts

import crypto from 'node:crypto';
import type {
  PushChannel,
  PushChannelType,
  ChannelConfig,
  WebhookChannelConfig,
  PushPayload,
  PushResult,
} from '../types.js';
import { logger } from '../../../shared/logger.js';

export class WebhookChannel implements PushChannel {
  readonly type: PushChannelType = 'webhook';

  validateConfig(config: ChannelConfig): { valid: boolean; error?: string } {
    if (config.type !== 'webhook') {
      return { valid: false, error: 'Config type mismatch' };
    }
    const wh = config as WebhookChannelConfig;
    try {
      new URL(wh.url);
      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid URL' };
    }
  }

  async send(config: ChannelConfig, payload: PushPayload): Promise<PushResult> {
    const start = Date.now();
    const whConfig = config as WebhookChannelConfig;

    try {
      const body = JSON.stringify({
        event: 'digest.push',
        digestId: payload.digestId,
        userId: payload.userId,
        tier: payload.tier,
        date: payload.date,
        title: payload.title,
        itemCount: payload.itemCount,
        contentMarkdown: payload.contentMarkdown,
        contentHtml: payload.contentHtml,
        webUrl: payload.webUrl,
        timestamp: new Date().toISOString(),
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'ArcLight-Webhook/1.0',
        ...(whConfig.headers || {}),
      };

      // HMAC 签名
      if (whConfig.secret) {
        const signature = crypto
          .createHmac('sha256', whConfig.secret)
          .update(body)
          .digest('hex');
        headers['X-ArcLight-Signature'] = `sha256=${signature}`;
      }

      const res = await fetch(whConfig.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000), // 10s 超时
      });

      if (!res.ok) {
        return {
          success: false,
          channelType: 'webhook',
          error: `HTTP ${res.status}: ${res.statusText}`,
          errorCode: String(res.status),
          retryable: res.status >= 500 || res.status === 429,
          durationMs: Date.now() - start,
        };
      }

      return {
        success: true,
        channelType: 'webhook',
        retryable: false,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      logger.error({ err, url: whConfig.url }, 'Webhook send failed');
      return {
        success: false,
        channelType: 'webhook',
        error: (err as Error).message,
        retryable: true,
        durationMs: Date.now() - start,
      };
    }
  }

  async sendTest(config: ChannelConfig): Promise<PushResult> {
    const whConfig = config as WebhookChannelConfig;
    return this.send(config, {
      digestId: 'test-' + Date.now(),
      userId: 'test',
      tier: 'daily',
      date: new Date().toISOString().split('T')[0],
      contentMarkdown: '# Test\n\nThis is a test webhook from ArcLight.',
      contentHtml: '<h1>Test</h1><p>This is a test webhook from ArcLight.</p>',
      title: 'Webhook 测试',
      itemCount: 0,
    });
  }
}
```

---

## 6. 推送状态管理

### 6.1 pushStatus 生命周期

```
                  ┌──────────┐
                  │  pending  │  ← Digest 生成后初始状态
                  └─────┬────┘
                        │
           推送调度器触发推送
                        │
                  ┌─────▼────┐
                  │  sending  │  ← 正在发送（至少一个通道）
                  └─────┬────┘
                        │
              ┌─────────┼─────────┐
              │                   │
        ┌─────▼────┐        ┌────▼─────┐
        │   sent    │        │  failed   │
        └──────────┘        └────┬─────┘
              所有通道成功         │ 有通道失败
                                 │
                        重试（最多 3 次）
                                 │
                        ┌────────┼────────┐
                        │                 │
                  ┌─────▼────┐     ┌─────▼──────┐
                  │   sent    │     │  exhausted  │
                  └──────────┘     └────────────┘
                   重试成功          重试用尽
```

**状态定义**（扩展现有 digests.pushStatus）：

```typescript
type PushStatus = 'pending' | 'sending' | 'sent' | 'partial' | 'failed' | 'exhausted' | 'skipped';
```

- `pending`：等待推送
- `sending`：正在推送中
- `sent`：所有通道推送成功
- `partial`：部分通道成功，部分失败
- `failed`：推送失败，等待重试
- `exhausted`：重试次数用尽
- `skipped`：被跳过（quiet hours、通道未配置等）

### 6.2 失败重试策略

```typescript
// packages/backend/src/engine/push/retry.ts

export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟（毫秒） */
  initialDelayMs: number;
  /** 退避倍数 */
  backoffMultiplier: number;
  /** 最大延迟（毫秒） */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 60_000,        // 1 分钟
  backoffMultiplier: 2,          // 指数退避
  maxDelayMs: 30 * 60_000,      // 最大 30 分钟
};

/**
 * 计算下次重试的延迟时间
 * @param attempt 当前是第几次重试（从 0 开始）
 */
export function getRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  // 加入抖动（±20%）避免集群重试风暴
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, config.maxDelayMs);
}

/**
 * 判断是否应该重试
 */
export function shouldRetry(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  return attempt < config.maxRetries;
}
```

**重试时间线示例**：
| 重试次数 | 延迟 | 累计 |
|---------|------|------|
| 第 1 次 | ~1 分钟 | ~1 分钟 |
| 第 2 次 | ~2 分钟 | ~3 分钟 |
| 第 3 次 | ~4 分钟 | ~7 分钟 |

### 6.3 Quiet Hours

```typescript
// packages/backend/src/engine/push/quiet-hours.ts

/**
 * 检查当前时间是否在 quiet hours 内
 * 
 * @param quietHoursStr 格式："23:00-07:00"（跨午夜）或 "01:00-06:00"
 * @param timezone 用户时区
 * @returns true 表示当前处于静默时段
 */
export function isQuietHours(quietHoursStr: string | undefined, timezone: string = 'UTC'): boolean {
  if (!quietHoursStr) return false;

  const match = quietHoursStr.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) return false;

  const [, startH, startM, endH, endM] = match;
  const startMinutes = Number(startH) * 60 + Number(startM);
  const endMinutes = Number(endH) * 60 + Number(endM);

  // 获取用户时区的当前时间
  const now = new Date();
  const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentMinutes = userTime.getHours() * 60 + userTime.getMinutes();

  // 跨午夜情况（如 23:00-07:00）
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // 同一天情况（如 01:00-06:00）
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/** 默认 quiet hours：23:00 - 07:00 */
export const DEFAULT_QUIET_HOURS = '23:00-07:00';
```

### 6.4 推送日志表

见 [第 9 节 数据库变更](#9-数据库变更)。

---

## 7. 推送调度

### 7.1 Push Dispatcher

```typescript
// packages/backend/src/engine/push/dispatcher.ts

import { db } from '../../db/client.js';
import { digests, userPreferences, users } from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { pushRegistry } from './registry.js';
import { isQuietHours, DEFAULT_QUIET_HOURS } from './quiet-hours.js';
import { shouldRetry, getRetryDelay, DEFAULT_RETRY_CONFIG } from './retry.js';
import { telegramRateLimiter } from './rate-limiter.js';
import { logger } from '../../shared/logger.js';
import type { ChannelConfig, PushChannelType, PushPayload, PushResult } from './types.js';

// push_logs 表的引用（见 schema 变更）
import { pushLogs } from '../../db/schema.js';

/** 用户的推送通道配置（从 userPreferences.pushChannels 提取） */
interface UserPushChannels {
  telegram?: { enabled: boolean; chatId?: string; botToken?: string };
  email?: { enabled: boolean; address?: string };
  webhook?: { enabled: boolean; url?: string; headers?: Record<string, string>; secret?: string };
}

/**
 * 推送调度器 — 核心推送引擎
 */
export class PushDispatcher {
  
  /**
   * 推送单个 digest 到用户的所有已启用通道
   */
  async pushDigest(digestId: string): Promise<{
    results: PushResult[];
    overallStatus: 'sent' | 'partial' | 'failed' | 'skipped';
  }> {
    // 1. 获取 digest
    const digest = await db.select().from(digests).where(eq(digests.id, digestId)).get();
    if (!digest) throw new Error(`Digest ${digestId} not found`);

    // 2. 获取用户信息和偏好
    const user = await db.select().from(users).where(eq(users.id, digest.userId)).get();
    const prefs = await db.select().from(userPreferences)
      .where(eq(userPreferences.userId, digest.userId)).get();

    if (!user || !prefs) {
      logger.warn({ digestId, userId: digest.userId }, 'User/prefs not found for push');
      return { results: [], overallStatus: 'skipped' };
    }

    // 3. 检查 quiet hours
    const alerts = prefs.alerts as { quietHours?: string } | null;
    const quietHours = alerts?.quietHours || DEFAULT_QUIET_HOURS;
    const timezone = user.timezone || 'UTC';

    if (isQuietHours(quietHours, timezone)) {
      logger.info({ digestId, userId: user.id, quietHours }, 'Skipping push: quiet hours');
      await db.update(digests)
        .set({ pushStatus: 'skipped' })
        .where(eq(digests.id, digestId));
      return { results: [], overallStatus: 'skipped' };
    }

    // 4. 标记为 sending
    await db.update(digests)
      .set({ pushStatus: 'sending' })
      .where(eq(digests.id, digestId));

    // 5. 构造 payload
    const payload: PushPayload = {
      digestId: digest.id,
      userId: digest.userId,
      tier: digest.tier as PushPayload['tier'],
      date: digest.date,
      contentMarkdown: digest.contentMarkdown || '',
      contentHtml: digest.contentHtml || '',
      title: this.getTierTitle(digest.tier),
      itemCount: (digest.metadata as { itemCount?: number })?.itemCount || 0,
      webUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/digests/${digest.id}`,
    };

    // 6. 遍历已启用通道发送
    const pushChannels = (prefs.pushChannels as UserPushChannels) || {};
    const results: PushResult[] = [];

    for (const [channelType, channelPrefs] of Object.entries(pushChannels)) {
      if (channelType === 'web') continue; // web 通道不需要推送
      if (!channelPrefs || !channelPrefs.enabled) continue;

      const channel = pushRegistry.get(channelType as PushChannelType);
      if (!channel) {
        logger.warn({ channelType }, 'Push channel not registered');
        continue;
      }

      // 构造通道配置
      const config = this.buildChannelConfig(channelType as PushChannelType, channelPrefs);
      if (!config) continue;

      // 验证配置
      const validation = channel.validateConfig(config);
      if (!validation.valid) {
        logger.warn({ channelType, error: validation.error }, 'Invalid channel config');
        results.push({
          success: false,
          channelType: channelType as PushChannelType,
          error: validation.error,
          retryable: false,
          durationMs: 0,
        });
        continue;
      }

      // Telegram 限流
      if (channelType === 'telegram') {
        await telegramRateLimiter.acquire();
      }

      // 发送
      const result = await channel.send(config, payload);
      results.push(result);

      // 写入推送日志
      await db.insert(pushLogs).values({
        id: nanoid(),
        digestId: digest.id,
        userId: digest.userId,
        channelType: channelType as PushChannelType,
        status: result.success ? 'sent' : 'failed',
        externalId: result.externalId || null,
        error: result.error || null,
        retryable: result.retryable ? 1 : 0,
        attempt: 1,
        durationMs: result.durationMs,
        createdAt: new Date(),
      });

      logger.info({
        digestId, channelType,
        success: result.success,
        durationMs: result.durationMs,
      }, 'Push attempt');
    }

    // 7. 计算 overall status
    const successes = results.filter(r => r.success).length;
    const total = results.length;
    let overallStatus: 'sent' | 'partial' | 'failed' | 'skipped';

    if (total === 0) {
      overallStatus = 'skipped';
    } else if (successes === total) {
      overallStatus = 'sent';
    } else if (successes > 0) {
      overallStatus = 'partial';
    } else {
      overallStatus = 'failed';
    }

    // 8. 更新 digest 状态
    await db.update(digests).set({
      pushStatus: overallStatus,
      pushedAt: overallStatus === 'sent' || overallStatus === 'partial' ? new Date() : null,
    }).where(eq(digests.id, digestId));

    return { results, overallStatus };
  }

  /**
   * 重试失败的推送
   */
  async retryFailedPushes(): Promise<void> {
    // 查找需要重试的推送日志
    const failedLogs = await db.select().from(pushLogs)
      .where(
        and(
          eq(pushLogs.status, 'failed'),
          eq(pushLogs.retryable, 1),
        )
      );

    for (const log of failedLogs) {
      const attempt = (log.attempt || 1);
      if (!shouldRetry(attempt - 1, DEFAULT_RETRY_CONFIG)) {
        // 超过最大重试次数，标记为 exhausted
        await db.update(pushLogs)
          .set({ status: 'exhausted' })
          .where(eq(pushLogs.id, log.id));
        continue;
      }

      // 检查是否到了重试时间
      const delay = getRetryDelay(attempt - 1, DEFAULT_RETRY_CONFIG);
      const retryAfter = new Date(log.createdAt!.getTime() + delay);
      if (new Date() < retryAfter) continue;

      // 获取 digest 和通道配置
      const digest = await db.select().from(digests).where(eq(digests.id, log.digestId)).get();
      if (!digest) continue;

      const prefs = await db.select().from(userPreferences)
        .where(eq(userPreferences.userId, log.userId)).get();
      if (!prefs) continue;

      const pushChannels = (prefs.pushChannels as UserPushChannels) || {};
      const channelPrefs = pushChannels[log.channelType as keyof UserPushChannels];
      if (!channelPrefs || !channelPrefs.enabled) continue;

      const channel = pushRegistry.get(log.channelType as PushChannelType);
      if (!channel) continue;

      const config = this.buildChannelConfig(log.channelType as PushChannelType, channelPrefs);
      if (!config) continue;

      const payload: PushPayload = {
        digestId: digest.id,
        userId: digest.userId,
        tier: digest.tier as PushPayload['tier'],
        date: digest.date,
        contentMarkdown: digest.contentMarkdown || '',
        contentHtml: digest.contentHtml || '',
        title: this.getTierTitle(digest.tier),
        itemCount: (digest.metadata as { itemCount?: number })?.itemCount || 0,
      };

      if (log.channelType === 'telegram') {
        await telegramRateLimiter.acquire();
      }

      const result = await channel.send(config, payload);

      // 更新日志
      await db.update(pushLogs).set({
        status: result.success ? 'sent' : 'failed',
        attempt: attempt + 1,
        error: result.error || null,
        retryable: result.retryable ? 1 : 0,
        durationMs: result.durationMs,
      }).where(eq(pushLogs.id, log.id));

      // 如果重试成功，更新 digest 状态
      if (result.success) {
        await db.update(digests).set({
          pushStatus: 'sent',
          pushedAt: new Date(),
        }).where(eq(digests.id, log.digestId));
      }

      logger.info({
        digestId: log.digestId,
        channelType: log.channelType,
        attempt: attempt + 1,
        success: result.success,
      }, 'Push retry');
    }
  }

  // ── 内部方法 ──

  private buildChannelConfig(
    type: PushChannelType,
    prefs: Record<string, unknown>,
  ): ChannelConfig | null {
    switch (type) {
      case 'telegram':
        if (!prefs.chatId) return null;
        return {
          type: 'telegram',
          chatId: prefs.chatId as string,
          botToken: prefs.botToken as string | undefined,
        };
      case 'email':
        if (!prefs.address) return null;
        return {
          type: 'email',
          address: prefs.address as string,
          verified: true, // MVP 先不做验证
        };
      case 'webhook':
        if (!prefs.url) return null;
        return {
          type: 'webhook',
          url: prefs.url as string,
          headers: prefs.headers as Record<string, string> | undefined,
          secret: prefs.secret as string | undefined,
        };
      default:
        return null;
    }
  }

  private getTierTitle(tier: string): string {
    const titles: Record<string, string> = {
      flash: '快讯',
      daily: '今日精选',
      deep: '深度推荐',
      weekly: '本周回顾',
      buzz: '热点速报',
      alert: '重要提醒',
    };
    return titles[tier] || '新闻推送';
  }
}
```

### 7.2 与 generate-digest job 集成

```typescript
// packages/backend/src/scheduler/jobs/generate-digest.ts（修改后）

import { db } from '../../db/client.js';
import { userPreferences } from '../../db/schema.js';
import { generateDigest } from '../../engine/digest/pipeline.js';
import { PushDispatcher } from '../../engine/push/dispatcher.js';
import { logger } from '../../shared/logger.js';

const pushDispatcher = new PushDispatcher();

/**
 * Check all users' schedules and generate digests when due.
 * Called every minute by the cron scheduler.
 * 
 * 修改：生成后自动触发推送
 */
export async function checkAndGenerateDigests(): Promise<void> {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const allPrefs = await db.select().from(userPreferences);

  for (const pref of allPrefs) {
    const schedule = pref.schedule as Record<string, { enabled?: boolean; time?: string; count?: number }> | null;
    if (!schedule) continue;

    for (const tier of ['flash', 'daily', 'deep'] as const) {
      const tierSchedule = schedule[tier];
      if (!tierSchedule?.enabled || tierSchedule.time !== currentTime) continue;

      try {
        logger.info({ userId: pref.userId, tier, time: currentTime }, 'Generating scheduled digest');
        const result = await generateDigest(pref.userId, {
          tier,
          count: tierSchedule.count || (tier === 'flash' ? 8 : tier === 'daily' ? 8 : 2),
        });

        // ✨ 新增：生成完成后自动推送
        if (result.items.length > 0) {
          try {
            const pushResult = await pushDispatcher.pushDigest(result.id);
            logger.info({
              digestId: result.id,
              tier,
              pushStatus: pushResult.overallStatus,
              channels: pushResult.results.length,
            }, 'Auto-push completed');
          } catch (pushErr) {
            logger.error({ err: pushErr, digestId: result.id }, 'Auto-push failed');
            // 推送失败不影响 digest 生成的状态
          }
        }
      } catch (err) {
        logger.error({ err, userId: pref.userId, tier }, 'Scheduled digest generation failed');
      }
    }
  }
}
```

### 7.3 独立重试 Job

```typescript
// packages/backend/src/scheduler/jobs/retry-push.ts

import { PushDispatcher } from '../../engine/push/dispatcher.js';
import { logger } from '../../shared/logger.js';

const pushDispatcher = new PushDispatcher();

/**
 * 定期检查并重试失败的推送
 * 建议每 2 分钟运行一次
 */
export async function retryFailedPushes(): Promise<void> {
  try {
    await pushDispatcher.retryFailedPushes();
  } catch (err) {
    logger.error({ err }, 'Push retry job failed');
  }
}
```

### 7.4 在 index.ts 中注册

```typescript
// packages/backend/src/index.ts — 新增部分

import { initPushChannels } from './engine/push/index.js';
import { retryFailedPushes } from './scheduler/jobs/retry-push.js';
import { pushRoutes } from './routes/push.js';

// ... 现有代码 ...

// 初始化推送通道
initPushChannels();

// 推送 API 路由
app.route('/api/v1/push', pushRoutes);

// 推送重试 cron — 每 2 分钟检查一次
cron.schedule('*/2 * * * *', () => {
  retryFailedPushes().catch((err) => logger.error({ err }, 'Push retry scheduler error'));
});
```

### 7.5 并发控制

```typescript
// packages/backend/src/engine/push/concurrency.ts

/**
 * 简单的并发控制器
 * 限制同时推送的用户数量，避免瞬间大量 API 调用
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// 全局并发限制：同时最多 5 个用户在推送
export const pushConcurrency = new ConcurrencyLimiter(5);
```

---

## 8. API 端点

### 8.1 推送渠道配置

```typescript
// packages/backend/src/routes/push.ts

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/client.js';
import { userPreferences, digests, pushLogs } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';
import { pushRegistry } from '../engine/push/index.js';
import { PushDispatcher } from '../engine/push/dispatcher.js';
import type { ChannelConfig, PushChannelType } from '../engine/push/types.js';

const pushRoutes = new Hono<{ Variables: AuthVariables }>();
pushRoutes.use('*', requireAuth);

const pushDispatcher = new PushDispatcher();

// ─────────────────────────────────────────────
// GET /api/v1/push/channels — 获取用户的推送通道配置
// ─────────────────────────────────────────────
pushRoutes.get('/channels', async (c) => {
  const user = c.get('user');
  const prefs = await db.select().from(userPreferences)
    .where(eq(userPreferences.userId, user.id)).get();

  const pushChannels = (prefs?.pushChannels as Record<string, unknown>) || {};
  const availableChannels = pushRegistry.listTypes();

  return c.json({
    data: {
      configured: pushChannels,
      available: availableChannels,
    },
  });
});

// ─────────────────────────────────────────────
// PUT /api/v1/push/channels/:type — 配置特定推送通道
// ─────────────────────────────────────────────
const telegramConfigSchema = z.object({
  enabled: z.boolean(),
  chatId: z.string().regex(/^-?\d+$/, 'Chat ID must be numeric').optional(),
});

const emailConfigSchema = z.object({
  enabled: z.boolean(),
  address: z.string().email().optional(),
});

const webhookConfigSchema = z.object({
  enabled: z.boolean(),
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  secret: z.string().optional(),
});

pushRoutes.put('/channels/:type', async (c) => {
  const user = c.get('user');
  const type = c.req.param('type') as PushChannelType;

  // 验证通道类型
  if (!['telegram', 'email', 'webhook'].includes(type)) {
    return c.json({ error: 'Unknown channel type' }, 400);
  }

  const body = await c.req.json();

  // 按类型验证
  let validatedConfig: Record<string, unknown>;
  switch (type) {
    case 'telegram':
      validatedConfig = telegramConfigSchema.parse(body);
      break;
    case 'email':
      validatedConfig = emailConfigSchema.parse(body);
      break;
    case 'webhook':
      validatedConfig = webhookConfigSchema.parse(body);
      break;
    default:
      return c.json({ error: 'Unknown channel type' }, 400);
  }

  // 如果通道已注册，验证配置有效性
  const channel = pushRegistry.get(type);
  if (channel && validatedConfig.enabled) {
    const config = { type, ...validatedConfig } as ChannelConfig;
    const validation = channel.validateConfig(config);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }
  }

  // 更新 userPreferences.pushChannels
  const prefs = await db.select().from(userPreferences)
    .where(eq(userPreferences.userId, user.id)).get();

  if (!prefs) {
    return c.json({ error: 'Preferences not found' }, 404);
  }

  const pushChannels = (prefs.pushChannels as Record<string, unknown>) || {};
  pushChannels[type] = { ...validatedConfig, type };

  await db.update(userPreferences)
    .set({ pushChannels, updatedAt: new Date() })
    .where(eq(userPreferences.userId, user.id));

  return c.json({ ok: true, channel: { type, ...validatedConfig } });
});

// ─────────────────────────────────────────────
// DELETE /api/v1/push/channels/:type — 删除/禁用推送通道
// ─────────────────────────────────────────────
pushRoutes.delete('/channels/:type', async (c) => {
  const user = c.get('user');
  const type = c.req.param('type');

  const prefs = await db.select().from(userPreferences)
    .where(eq(userPreferences.userId, user.id)).get();

  if (!prefs) return c.json({ error: 'Preferences not found' }, 404);

  const pushChannels = (prefs.pushChannels as Record<string, unknown>) || {};
  delete pushChannels[type];

  await db.update(userPreferences)
    .set({ pushChannels, updatedAt: new Date() })
    .where(eq(userPreferences.userId, user.id));

  return c.json({ ok: true });
});

// ─────────────────────────────────────────────
// POST /api/v1/push/test — 发送测试推送
// ─────────────────────────────────────────────
pushRoutes.post('/test', zValidator('json', z.object({
  channelType: z.enum(['telegram', 'email', 'webhook']),
})), async (c) => {
  const user = c.get('user');
  const { channelType } = c.req.valid('json');

  const channel = pushRegistry.get(channelType);
  if (!channel) {
    return c.json({ error: `Channel ${channelType} not available` }, 400);
  }

  // 从用户配置获取通道参数
  const prefs = await db.select().from(userPreferences)
    .where(eq(userPreferences.userId, user.id)).get();

  const pushChannels = (prefs?.pushChannels as Record<string, unknown>) || {};
  const channelPrefs = pushChannels[channelType] as Record<string, unknown> | undefined;

  if (!channelPrefs || !channelPrefs.enabled) {
    return c.json({ error: `Channel ${channelType} not configured or disabled` }, 400);
  }

  const config = { type: channelType, ...channelPrefs } as ChannelConfig;
  const result = await channel.sendTest(config);

  return c.json({
    success: result.success,
    error: result.error,
    durationMs: result.durationMs,
  });
});

// ─────────────────────────────────────────────
// POST /api/v1/push/send/:digestId — 手动推送特定 digest
// ─────────────────────────────────────────────
pushRoutes.post('/send/:digestId', async (c) => {
  const user = c.get('user');
  const digestId = c.req.param('digestId');

  // 验证 digest 属于当前用户
  const digest = await db.select().from(digests)
    .where(and(eq(digests.id, digestId), eq(digests.userId, user.id)))
    .get();

  if (!digest) return c.json({ error: 'Digest not found' }, 404);

  const result = await pushDispatcher.pushDigest(digestId);
  return c.json(result);
});

// ─────────────────────────────────────────────
// GET /api/v1/push/history — 推送历史
// ─────────────────────────────────────────────
pushRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const limit = Number(c.req.query('limit') || '50');
  const channelType = c.req.query('channel');

  let query = db.select().from(pushLogs)
    .where(eq(pushLogs.userId, user.id))
    .orderBy(desc(pushLogs.createdAt))
    .limit(limit);

  const results = await query;

  // 如果指定了通道类型，过滤
  const filtered = channelType
    ? results.filter(r => r.channelType === channelType)
    : results;

  return c.json({ data: filtered });
});

// ─────────────────────────────────────────────
// GET /api/v1/push/stats — 推送统计
// ─────────────────────────────────────────────
pushRoutes.get('/stats', async (c) => {
  const user = c.get('user');

  const logs = await db.select().from(pushLogs)
    .where(eq(pushLogs.userId, user.id));

  const stats = {
    total: logs.length,
    sent: logs.filter(l => l.status === 'sent').length,
    failed: logs.filter(l => l.status === 'failed' || l.status === 'exhausted').length,
    byChannel: {} as Record<string, { total: number; sent: number; failed: number }>,
  };

  for (const log of logs) {
    if (!stats.byChannel[log.channelType]) {
      stats.byChannel[log.channelType] = { total: 0, sent: 0, failed: 0 };
    }
    stats.byChannel[log.channelType].total++;
    if (log.status === 'sent') stats.byChannel[log.channelType].sent++;
    if (log.status === 'failed' || log.status === 'exhausted') stats.byChannel[log.channelType].failed++;
  }

  return c.json({ data: stats });
});

// ─────────────────────────────────────────────
// Telegram Webhook（Bot /start 绑定 — 延后功能）
// ─────────────────────────────────────────────
// POST /api/v1/push/telegram/webhook
// 详见 3.2 节 Telegram Webhook Handler

export { pushRoutes };
```

### 8.2 API 端点汇总

| 方法 | 路径 | 说明 | MVP |
|------|------|------|-----|
| `GET` | `/api/v1/push/channels` | 获取推送通道配置 | ✅ |
| `PUT` | `/api/v1/push/channels/:type` | 配置推送通道 | ✅ |
| `DELETE` | `/api/v1/push/channels/:type` | 删除推送通道 | ✅ |
| `POST` | `/api/v1/push/test` | 发送测试推送 | ✅ |
| `POST` | `/api/v1/push/send/:digestId` | 手动推送 digest | ✅ |
| `GET` | `/api/v1/push/history` | 推送历史 | ✅ |
| `GET` | `/api/v1/push/stats` | 推送统计 | 🟡 |
| `POST` | `/api/v1/push/telegram/webhook` | Telegram Bot webhook | 🟡 |
| `POST` | `/api/v1/push/telegram/bind` | 生成 Telegram 绑定链接 | 🟡 |

---

## 9. 数据库变更

### 9.1 新增表：push_logs

```typescript
// packages/backend/src/db/schema.ts — 新增

// ═══════════════════════════════════════════
// Push Logs
// ═══════════════════════════════════════════

export const pushLogs = sqliteTable('push_logs', {
  id: text('id').primaryKey(),
  digestId: text('digest_id').notNull().references(() => digests.id),
  userId: text('user_id').notNull().references(() => users.id),
  /** 推送通道类型 */
  channelType: text('channel_type').notNull(), // 'telegram' | 'email' | 'webhook'
  /** 推送状态 */
  status: text('status').notNull(), // 'pending' | 'sending' | 'sent' | 'failed' | 'exhausted'
  /** 外部消息 ID（Telegram message_id / Email message-id） */
  externalId: text('external_id'),
  /** 错误信息 */
  error: text('error'),
  /** 是否可重试 */
  retryable: integer('retryable').default(0),
  /** 当前重试次数 */
  attempt: integer('attempt').default(1),
  /** 发送耗时 ms */
  durationMs: integer('duration_ms'),
  /** 创建时间 */
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

### 9.2 修改现有表：digests

扩展 `pushStatus` 枚举：

```typescript
// 现有定义（需修改）
pushStatus: text('push_status', { 
  enum: ['pending', 'sending', 'sent', 'partial', 'failed', 'exhausted', 'skipped'] 
}).default('pending'),

// 新增字段
pushAttempts: integer('push_attempts').default(0),
```

### 9.3 修改现有表：userPreferences

`pushChannels` JSON 结构更新（向后兼容，仍为 JSON 字段）：

```typescript
// 现有的 pushChannels 类型扩展
pushChannels: text('push_channels', { mode: 'json' }).$type<{
  web?: { enabled: boolean };
  telegram?: { 
    enabled: boolean; 
    chatId?: string; 
    botToken?: string;       // 可选自定义 bot
    bindMethod?: 'manual' | 'bot_start';
    boundAt?: string;
  };
  email?: { 
    enabled: boolean; 
    address?: string;
    verified?: boolean;
  };
  webhook?: { 
    enabled: boolean; 
    url?: string;
    headers?: Record<string, string>;
    secret?: string;
  };
}>(),
```

### 9.4 Migration 脚本

```sql
-- drizzle/XXXX_add_push_logs.sql

-- 新增 push_logs 表
CREATE TABLE IF NOT EXISTS `push_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `digest_id` text NOT NULL REFERENCES `digests`(`id`),
  `user_id` text NOT NULL REFERENCES `user`(`id`),
  `channel_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `external_id` text,
  `error` text,
  `retryable` integer DEFAULT 0,
  `attempt` integer DEFAULT 1,
  `duration_ms` integer,
  `created_at` integer NOT NULL
);

-- 索引：按用户查询推送历史
CREATE INDEX IF NOT EXISTS `idx_push_logs_user_id` ON `push_logs`(`user_id`);

-- 索引：按 digest 查询推送记录
CREATE INDEX IF NOT EXISTS `idx_push_logs_digest_id` ON `push_logs`(`digest_id`);

-- 索引：查找需要重试的记录
CREATE INDEX IF NOT EXISTS `idx_push_logs_retry` ON `push_logs`(`status`, `retryable`);

-- 扩展 digests 表（添加 push_attempts 列）
ALTER TABLE `digests` ADD COLUMN `push_attempts` integer DEFAULT 0;
```

**Drizzle 生成 migration**：
```bash
cd packages/backend
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

## 10. 文件结构

```
packages/backend/src/engine/push/
├── index.ts              # 通道初始化 + re-exports
├── types.ts              # 所有类型定义（PushChannel, PushPayload, PushResult, ChannelConfig）
├── registry.ts           # PushChannelRegistry 通道注册中心
├── dispatcher.ts         # PushDispatcher 推送调度核心
├── retry.ts              # 重试策略（指数退避）
├── quiet-hours.ts        # 静默时段检查
├── rate-limiter.ts       # 令牌桶限流器
├── concurrency.ts        # 并发控制器
└── channels/
    ├── telegram.ts       # TelegramChannel 实现
    ├── telegram-webhook.ts  # Telegram Bot webhook handler（/start 绑定）
    ├── email.ts          # EmailChannel 实现（Resend / SMTP）
    └── webhook.ts        # WebhookChannel 实现

packages/backend/src/scheduler/jobs/
├── generate-digest.ts    # 修改：生成后自动推送
└── retry-push.ts         # 新增：推送重试 job

packages/backend/src/routes/
└── push.ts               # 新增：推送 API 路由

packages/backend/src/db/
└── schema.ts             # 修改：新增 push_logs 表 + digests 扩展
```

---

## 11. MVP 优先级

### 🔴 MVP 必须（Phase 1 交付）

| 模块 | 文件 | 说明 |
|------|------|------|
| 类型定义 | `types.ts` | 所有 interface 和类型 |
| 通道注册 | `registry.ts`, `index.ts` | 通道注册/发现 |
| Telegram 推送 | `channels/telegram.ts` | 核心推送通道 |
| 推送调度 | `dispatcher.ts` | 核心推送引擎 |
| 生成后自动推送 | `generate-digest.ts` 修改 | 端到端打通 |
| 推送 API | `routes/push.ts` | 配置 + 测试 + 手动推送 |
| DB 变更 | `schema.ts` + migration | push_logs 表 |
| Quiet Hours | `quiet-hours.ts` | 深夜不推送 |

### 🟡 延后（Phase 1 可选）

| 模块 | 文件 | 说明 |
|------|------|------|
| Email 推送 | `channels/email.ts` | 可在 Telegram 稳定后加入 |
| 重试机制 | `retry.ts`, `retry-push.ts` | 先做基础版，失败就失败 |
| 限流 | `rate-limiter.ts` | 用户少时可以不做 |
| 并发控制 | `concurrency.ts` | 用户少时可以不做 |
| 推送统计 API | `GET /push/stats` | 功能锦上添花 |

### 🔵 未来（Phase 2+）

| 模块 | 说明 |
|------|------|
| Telegram `/start` 绑定 | `telegram-webhook.ts` |
| Webhook 推送 | `channels/webhook.ts` |
| Email 验证流程 | 发送验证码确认邮箱 |
| 微信推送 | 需要企业微信或第三方服务 |
| 推送模板自定义 | 用户自定义推送格式 |
| 推送 A/B 测试 | 不同格式效果对比 |

---

## 附录A：Telegram MarkdownV2 转义

> **设计决策**：本方案选择 Telegram **HTML 模式**而非 MarkdownV2。

原因：
1. MarkdownV2 要求转义以下所有特殊字符：`` _ * [ ] ( ) ~ ` > # + - = | { } . ! ``
2. 新闻内容中大量包含这些字符，逐一转义极易出错
3. HTML 模式只需转义 `< > & "`，规则简单

如果确实需要 MarkdownV2：

```typescript
/** 转义 Telegram MarkdownV2 特殊字符 */
function escapeTelegramMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
```

支持的 HTML 标签（Telegram）：
- `<b>bold</b>`
- `<i>italic</i>`
- `<u>underline</u>`
- `<s>strikethrough</s>`
- `<a href="url">link</a>`
- `<code>inline code</code>`
- `<pre>code block</pre>`
- `<blockquote>quote</blockquote>`（2024 新增）

---

## 附录B：Email HTML 模板

完整邮件模板见 `EmailChannel.wrapEmailTemplate()` 方法。

关键设计原则：
1. 使用 table-based layout（兼容 Outlook）
2. 所有样式 inline（邮件客户端会 strip `<style>` 标签）
3. 最大宽度 600px（移动端友好）
4. 深色 header + 白色内容区（品牌感）
5. 底部含"管理设置"链接（退订合规）

---

## 附录C：环境变量清单

```bash
# ── 推送通道 ──

# Telegram（MVP 必须）
TELEGRAM_BOT_TOKEN=           # BotFather 获取
TELEGRAM_WEBHOOK_URL=         # 可选，用于 /start 绑定

# Email（延后）
RESEND_API_KEY=               # Resend API Key
# 或
SMTP_HOST=                    # SMTP 服务器
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="ArcLight <noreply@arclight.app>"

# Email 发件人（通用）
EMAIL_FROM="ArcLight <noreply@arclight.app>"

# ── 推送配置 ──
PUSH_MAX_RETRIES=3            # 最大重试次数
PUSH_QUIET_HOURS=23:00-07:00  # 默认静默时段
PUSH_CONCURRENCY=5            # 并发推送数

# ── 前端 ──
FRONTEND_URL=http://localhost:5173  # 用于生成"查看详情"链接

# ── 加密 ──
ENCRYPTION_KEY=               # 用于加密存储的敏感信息（如用户自带的 bot token）
```

---

*本方案基于 ArcLight 现有架构（Hono + Drizzle + SQLite）设计，所有代码与现有模块风格保持一致。推送引擎与 Digest pipeline 松耦合，通过 digestId 关联，互不影响。*

*设计完成 — 2026-03-07*

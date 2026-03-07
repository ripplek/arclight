import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { digests, userPreferences, users, pushLogs } from '../../db/schema.js';
import { pushRegistry } from './registry.js';
import { isQuietHours, DEFAULT_QUIET_HOURS } from './quiet-hours.js';
import { logger } from '../../shared/logger.js';
import type { ChannelConfig, PushChannelType, PushPayload, PushResult } from './types.js';

interface UserPushChannels {
  telegram?: {
    enabled: boolean;
    chatId?: string;
    botToken?: string;
    bindMethod?: 'manual' | 'bot_start';
    boundAt?: string;
  };
  email?: { enabled: boolean; address?: string };
  webhook?: { enabled: boolean; url?: string; headers?: Record<string, string>; secret?: string };
}

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 60_000,
  backoffMultiplier: 2,
  maxDelayMs: 30 * 60_000,
};

export class PushDispatcher {
  async pushDigest(digestId: string): Promise<{
    results: PushResult[];
    overallStatus: 'sent' | 'partial' | 'failed' | 'skipped';
  }> {
    const digest = await db.select().from(digests).where(eq(digests.id, digestId)).get();
    if (!digest) throw new Error(`Digest ${digestId} not found`);

    const user = await db.select().from(users).where(eq(users.id, digest.userId)).get();
    const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, digest.userId)).get();

    if (!user || !prefs) {
      logger.warn({ digestId, userId: digest.userId }, 'User/prefs not found for push');
      return { results: [], overallStatus: 'skipped' };
    }

    const alerts = prefs.alerts as { quietHours?: string } | null;
    const quietHours = alerts?.quietHours || DEFAULT_QUIET_HOURS;
    const timezone = user.timezone || 'UTC';

    if (isQuietHours(quietHours, timezone)) {
      logger.info({ digestId, userId: user.id, quietHours, timezone }, 'Skipping push: quiet hours');
      await db.update(digests).set({ pushStatus: 'skipped' }).where(eq(digests.id, digestId));
      return { results: [], overallStatus: 'skipped' };
    }

    await db.update(digests)
      .set({
        pushStatus: 'sending',
        pushAttempts: (digest.pushAttempts ?? 0) + 1,
      })
      .where(eq(digests.id, digestId));

    const payload: PushPayload = {
      digestId: digest.id,
      userId: digest.userId,
      tier: digest.tier,
      date: digest.date,
      contentMarkdown: digest.contentMarkdown || '',
      contentHtml: digest.contentHtml || '',
      title: this.getTierTitle(digest.tier),
      itemCount: (digest.metadata as { itemCount?: number } | null)?.itemCount || 0,
      webUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/digests/${digest.id}`,
    };

    const pushChannels = (prefs.pushChannels as UserPushChannels) || {};
    const results: PushResult[] = [];

    for (const [channelTypeRaw, channelPrefsRaw] of Object.entries(pushChannels as Record<string, unknown>)) {
      if (channelTypeRaw === 'web') continue;
      if (!channelPrefsRaw || typeof channelPrefsRaw !== 'object') continue;

      const channelPrefs = channelPrefsRaw as Record<string, unknown>;
      if (!channelPrefs.enabled) continue;

      const channelType = channelTypeRaw as PushChannelType;
      const channel = pushRegistry.get(channelType);
      if (!channel) {
        logger.warn({ channelType }, 'Push channel not registered');
        continue;
      }

      const config = this.buildChannelConfig(channelType, channelPrefs);
      if (!config) continue;

      const validation = channel.validateConfig(config);
      if (!validation.valid) {
        logger.warn({ channelType, error: validation.error }, 'Invalid channel config');
        results.push({
          success: false,
          channelType,
          error: validation.error,
          retryable: false,
          durationMs: 0,
        });
        continue;
      }

      const result = await channel.send(config, payload);
      results.push(result);

      await db.insert(pushLogs).values({
        id: nanoid(),
        digestId: digest.id,
        userId: digest.userId,
        channelType,
        status: result.success ? 'sent' : 'failed',
        externalId: result.externalId || null,
        error: result.error || null,
        retryable: result.retryable ? 1 : 0,
        attempt: 1,
        durationMs: result.durationMs,
        createdAt: new Date(),
      });

      logger.info({
        digestId,
        channelType,
        success: result.success,
        durationMs: result.durationMs,
      }, 'Push attempt');
    }

    const successes = results.filter((r) => r.success).length;
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

    await db.update(digests)
      .set({
        pushStatus: overallStatus,
        pushedAt: overallStatus === 'sent' || overallStatus === 'partial' ? new Date() : null,
      })
      .where(eq(digests.id, digestId));

    return { results, overallStatus };
  }

  async retryFailedPushes(): Promise<void> {
    const failedLogs = await db
      .select()
      .from(pushLogs)
      .where(and(eq(pushLogs.status, 'failed'), eq(pushLogs.retryable, 1)));

    for (const log of failedLogs) {
      const attempt = log.attempt || 1;
      if (!shouldRetry(attempt - 1)) {
        await db.update(pushLogs).set({ status: 'exhausted' }).where(eq(pushLogs.id, log.id));
        await db.update(digests).set({ pushStatus: 'exhausted' }).where(eq(digests.id, log.digestId));
        continue;
      }

      const delay = getRetryDelay(attempt - 1);
      const createdAt = log.createdAt || new Date();
      const retryAfter = new Date(createdAt.getTime() + delay);
      if (new Date() < retryAfter) continue;

      const digest = await db.select().from(digests).where(eq(digests.id, log.digestId)).get();
      if (!digest) continue;

      const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, log.userId)).get();
      if (!prefs) continue;

      const pushChannels = (prefs.pushChannels as UserPushChannels) || {};
      const channelPrefs = pushChannels[log.channelType as keyof UserPushChannels];
      if (!channelPrefs || !channelPrefs.enabled) continue;

      const channelType = log.channelType as PushChannelType;
      const channel = pushRegistry.get(channelType);
      if (!channel) continue;

      const config = this.buildChannelConfig(channelType, channelPrefs as Record<string, unknown>);
      if (!config) continue;

      const payload: PushPayload = {
        digestId: digest.id,
        userId: digest.userId,
        tier: digest.tier,
        date: digest.date,
        contentMarkdown: digest.contentMarkdown || '',
        contentHtml: digest.contentHtml || '',
        title: this.getTierTitle(digest.tier),
        itemCount: (digest.metadata as { itemCount?: number } | null)?.itemCount || 0,
        webUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/digests/${digest.id}`,
      };

      const result = await channel.send(config, payload);

      await db.update(pushLogs)
        .set({
          status: result.success ? 'sent' : 'failed',
          attempt: attempt + 1,
          externalId: result.externalId || log.externalId,
          error: result.error || null,
          retryable: result.retryable ? 1 : 0,
          durationMs: result.durationMs,
        })
        .where(eq(pushLogs.id, log.id));

      if (result.success) {
        await db.update(digests)
          .set({
            pushStatus: 'sent',
            pushedAt: new Date(),
            pushAttempts: (digest.pushAttempts ?? 0) + 1,
          })
          .where(eq(digests.id, log.digestId));
      }

      logger.info({
        digestId: log.digestId,
        channelType: log.channelType,
        attempt: attempt + 1,
        success: result.success,
      }, 'Push retry');
    }
  }

  private buildChannelConfig(type: PushChannelType, prefs: Record<string, unknown>): ChannelConfig | null {
    switch (type) {
      case 'telegram':
        if (!prefs.chatId) return null;
        return {
          type: 'telegram',
          chatId: prefs.chatId as string,
          botToken: prefs.botToken as string | undefined,
          bindMethod: prefs.bindMethod as 'manual' | 'bot_start' | undefined,
          boundAt: prefs.boundAt as string | undefined,
        };
      case 'email':
        if (!prefs.address) return null;
        return {
          type: 'email',
          address: prefs.address as string,
          verified: Boolean(prefs.verified ?? true),
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

function getRetryDelay(attempt: number): number {
  const delay = DEFAULT_RETRY_CONFIG.initialDelayMs * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt);
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, DEFAULT_RETRY_CONFIG.maxDelayMs);
}

function shouldRetry(attempt: number): boolean {
  return attempt < DEFAULT_RETRY_CONFIG.maxRetries;
}

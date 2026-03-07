// packages/backend/src/scheduler/jobs/generate-digest.ts
import { db } from '../../db/client.js';
import { userPreferences } from '../../db/schema.js';
import { generateDigest } from '../../engine/digest/pipeline.js';
import { PushDispatcher } from '../../engine/push/dispatcher.js';
import { logger } from '../../shared/logger.js';

const pushDispatcher = new PushDispatcher();

/**
 * Check all users' schedules and generate digests when due.
 * Called every minute by the cron scheduler.
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
          }
        }
      } catch (err) {
        logger.error({ err, userId: pref.userId, tier }, 'Scheduled digest generation failed');
      }
    }
  }
}

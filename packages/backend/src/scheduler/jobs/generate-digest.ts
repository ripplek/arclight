// packages/backend/src/scheduler/jobs/generate-digest.ts
import { db } from '../../db/client.js';
import { userPreferences } from '../../db/schema.js';
import { generateDigest } from '../../engine/digest/pipeline.js';
import { logger } from '../../shared/logger.js';

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

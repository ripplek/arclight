import { PushDispatcher } from '../../engine/push/dispatcher.js';
import { logger } from '../../shared/logger.js';

const pushDispatcher = new PushDispatcher();

/**
 * Periodically check and retry failed pushes.
 */
export async function retryFailedPushes(): Promise<void> {
  try {
    await pushDispatcher.retryFailedPushes();
  } catch (err) {
    logger.error({ err }, 'Push retry job failed');
  }
}

import { logger } from '../../shared/logger.js';
import { TelegramChannel } from './channels/telegram.js';
import { pushRegistry } from './registry.js';

export function initPushChannels(): void {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    pushRegistry.register(new TelegramChannel(telegramToken));
    logger.info('Push channel registered: telegram');
  } else {
    logger.warn('TELEGRAM_BOT_TOKEN not set, telegram push disabled');
  }

  logger.info({ channels: pushRegistry.listTypes() }, 'Push channels initialized');
}

export { pushRegistry } from './registry.js';
export { PushDispatcher } from './dispatcher.js';
export type * from './types.js';

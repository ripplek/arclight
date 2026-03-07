/** Push channel type marker */
export type PushChannelType = 'telegram' | 'email' | 'webhook';

export interface TelegramChannelConfig {
  type: 'telegram';
  chatId: string;
  botToken?: string;
  bindMethod?: 'manual' | 'bot_start';
  boundAt?: string;
}

export interface EmailChannelConfig {
  type: 'email';
  address: string;
  verified: boolean;
  verificationToken?: string;
}

export interface WebhookChannelConfig {
  type: 'webhook';
  url: string;
  headers?: Record<string, string>;
  secret?: string;
}

export type ChannelConfig = TelegramChannelConfig | EmailChannelConfig | WebhookChannelConfig;

export interface PushPayload {
  digestId: string;
  userId: string;
  tier: 'flash' | 'daily' | 'deep' | 'weekly' | 'buzz' | 'alert';
  date: string;
  contentMarkdown: string;
  contentHtml: string;
  title: string;
  itemCount: number;
  webUrl?: string;
}

export interface PushResult {
  success: boolean;
  channelType: PushChannelType;
  externalId?: string;
  error?: string;
  errorCode?: string;
  retryable: boolean;
  durationMs: number;
}

export interface PushChannel {
  readonly type: PushChannelType;

  send(config: ChannelConfig, payload: PushPayload): Promise<PushResult>;

  validateConfig(config: ChannelConfig): { valid: boolean; error?: string };

  sendTest(config: ChannelConfig): Promise<PushResult>;
}

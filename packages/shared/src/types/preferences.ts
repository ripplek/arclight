// ═══════════════════════════════════════════
// User Preferences Types
// ═══════════════════════════════════════════

export interface TopicConfig {
  name: string;
  keywords: string[];
  excludeKeywords?: string[];
  boost: number;
}

export interface ScheduleConfig {
  flash?: { enabled: boolean; time: string; count: number };
  daily?: { enabled: boolean; time: string; count: number };
  deep?: { enabled: boolean; time: string; count: number };
  weekly?: { enabled: boolean; dayOfWeek: number; time: string };
  buzz?: { enabled: boolean; time: string; count: number };
}

export interface PushChannelConfig {
  web?: { enabled: boolean };
  email?: { enabled: boolean; address?: string };
  telegram?: { enabled: boolean; chatId?: string; botToken?: string };
  webhook?: { enabled: boolean; url?: string };
}

export interface UserPreferences {
  topics: TopicConfig[];
  schedule: ScheduleConfig;
  pushChannels: PushChannelConfig;
  serendipity: {
    enabled: boolean;
    slotsPerDigest: number;
    strategy: string;
    minBuzz?: number;
  };
  ranking?: {
    tierWeights?: Record<number, number>;
    buzzWeight?: number;
    recencyHours?: number;
    arcActiveBoost?: number;
  };
  llmConfig?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    contextInjection?: boolean;
    arcConfirm?: boolean;
  };
  alerts?: {
    enabled: boolean;
    minBuzz?: number;
    minTier1Sources?: number;
    cooldownHours?: number;
    quietHours?: string;
  };
}

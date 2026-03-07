import type { PushChannel, PushChannelType } from './types.js';

class PushChannelRegistry {
  private channels = new Map<PushChannelType, PushChannel>();

  register(channel: PushChannel): void {
    this.channels.set(channel.type, channel);
  }

  get(type: PushChannelType): PushChannel | undefined {
    return this.channels.get(type);
  }

  getAll(): PushChannel[] {
    return Array.from(this.channels.values());
  }

  has(type: PushChannelType): boolean {
    return this.channels.has(type);
  }

  listTypes(): PushChannelType[] {
    return Array.from(this.channels.keys());
  }
}

export const pushRegistry = new PushChannelRegistry();

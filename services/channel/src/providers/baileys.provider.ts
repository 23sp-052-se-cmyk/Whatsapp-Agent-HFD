import type { ChannelMessageContent } from '@repo/shared';
import type { SocketRegistry } from '../socket-registry';

export class BaileysProvider {
  constructor(private readonly registry: SocketRegistry) {}

  async sendMessage(
    channelId: string,
    to: string,
    content: ChannelMessageContent,
  ): Promise<string> {
    return this.registry.send(channelId, to, content);
  }

  async openChannel(channelId: string, orgId: string, phone?: string): Promise<void> {
    return this.registry.open(channelId, orgId, phone);
  }

  async closeChannel(channelId: string): Promise<void> {
    return this.registry.close(channelId);
  }

  isConnected(channelId: string): boolean {
    return this.registry.isOpen(channelId);
  }
}

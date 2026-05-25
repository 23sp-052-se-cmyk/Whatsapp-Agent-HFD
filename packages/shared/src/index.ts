export enum OrganizationRole {
  Owner = 'owner',
  Admin = 'admin',
  Agent = 'agent',
  Viewer = 'viewer',
}

export enum ChannelKind {
  Baileys = 'baileys',
  CloudApi = 'cloud_api',
}

export enum ChannelStatus {
  Pending = 'pending',
  Connected = 'connected',
  Disconnected = 'disconnected',
  Degraded = 'degraded',
  RateLimited = 'rate_limited',
  Banned = 'banned',
}

export interface AuthenticatedUser {
  sub: string;
  orgId: string;
  email: string;
  role: OrganizationRole;
}

// --- BullMQ job payloads ---

export interface OutboundMessageJob {
  channelId: string;
  orgId: string;
  conversationId: string;
  messageId: string;
  to: string;
  content: ChannelMessageContent;
}

export interface PairChannelJob {
  channelId: string;
  orgId: string;
  phone?: string;
}

// --- Message content ---

export type ChannelMessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'media'; mediaUrl: string; caption?: string; mimeType?: string }
  | {
      kind: 'audio';
      mediaBase64: string;
      mimeType?: string;
      seconds?: number;
      transcript?: string;
    };

// --- Redis pub/sub events ---

export interface InboundMessageEvent {
  channelId: string;
  orgId: string;
  externalMessageId: string;
  from: string;
  receivedAt: string;
  content: ChannelMessageContent;
}

export interface MessageStatusEvent {
  channelId: string;
  orgId: string;
  externalMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  occurredAt: string;
  reason?: string;
}

export interface QrCodeEvent {
  channelId: string;
  orgId: string;
  qr: string;
  generatedAt: string;
}

export interface ChannelConnectedEvent {
  channelId: string;
  orgId: string;
  phoneNumber: string;
  connectedAt: string;
}

export interface ChannelDisconnectedEvent {
  channelId: string;
  orgId: string;
  reason?: string;
  disconnectedAt: string;
}

// Redis pub/sub channel keys
export const REDIS_CHANNELS = {
  inboundMessage: 'events:inbound-message',
  messageStatus: 'events:message-status',
  qrCode: (channelId: string) => `events:qr:${channelId}`,
  channelConnected: 'events:channel-connected',
  channelDisconnected: 'events:channel-disconnected',
} as const;

// BullMQ queue names
export const QUEUE_NAMES = {
  outbound: 'outbound-messages',
  pairChannel: 'pair-channel',
} as const;

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  proto,
} from '@whiskeysockets/baileys';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import IORedis from 'ioredis';
import { and, channels, db, eq } from '@repo/db';
import {
  type ChannelMessageContent,
  type InboundMessageEvent,
  type MessageStatusEvent,
  type QrCodeEvent,
  type ChannelConnectedEvent,
  type ChannelDisconnectedEvent,
  REDIS_CHANNELS,
} from '@repo/shared';

export interface SocketEntry {
  socket: ReturnType<typeof makeWASocket>;
  orgId: string;
  channelId: string;
  phone?: string;
  pairingCodeRequested?: boolean;
}

const SESSION_DIR = process.env['SESSION_DIR'] ?? join(process.cwd(), '.sessions');
const silentLogger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return silentLogger;
  },
};

function toWaJid(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.includes('@')) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

export class SocketRegistry {
  private readonly sockets = new Map<string, SocketEntry>();

  constructor(private readonly redis: IORedis) {}

  async open(channelId: string, orgId: string, pairingPhone?: string): Promise<void> {
    if (this.sockets.has(channelId)) return;

    const sessionPath = join(SESSION_DIR, channelId);
    await mkdir(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger as any),
      },
      logger: silentLogger as any,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
    });

    const entry: SocketEntry = { socket: sock, orgId, channelId };
    this.sockets.set(channelId, entry);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if ((connection === 'connecting' || qr) && pairingPhone && !entry.pairingCodeRequested) {
        entry.pairingCodeRequested = true;
        const phone = pairingPhone.replace(/\D/g, '');
        try {
          const code = await sock.requestPairingCode(phone);
          await this.redis.set(
            `channels:${channelId}:latest-pair-code`,
            JSON.stringify({
              channelId,
              orgId,
              phone,
              code,
              generatedAt: new Date().toISOString(),
            }),
            'EX',
            120,
          );
          console.log(`WhatsApp pairing code generated channel=${channelId} phone=${phone}`);
        } catch (err) {
          console.error(`Failed to request pairing code channel=${channelId}:`, err);
        }
      }

      if (qr) {
        const event: QrCodeEvent = {
          channelId,
          orgId,
          qr,
          generatedAt: new Date().toISOString(),
        };
        await db
          .update(channels)
          .set({ status: 'reconnecting', updatedAt: new Date() })
          .where(and(eq(channels.id, channelId), eq(channels.orgId, orgId)));
        await this.redis.set(`channels:${channelId}:latest-qr`, JSON.stringify(event), 'EX', 120);
        await this.redis.publish(REDIS_CHANNELS.qrCode(channelId), JSON.stringify(event));
      }

      if (connection === 'open') {
        const phone = sock.user?.id?.split(':')[0] ?? '';
        console.log(`WhatsApp channel open channel=${channelId} phone=${phone}`);
        entry.phone = phone;
        await db
          .update(channels)
          .set({ status: 'connected', phone, updatedAt: new Date() })
          .where(and(eq(channels.id, channelId), eq(channels.orgId, orgId)));

        const event: ChannelConnectedEvent = {
          channelId,
          orgId,
          phoneNumber: phone,
          connectedAt: new Date().toISOString(),
        };
        await this.redis.publish(REDIS_CHANNELS.channelConnected, JSON.stringify(event));
      }

      if (connection === 'close') {
        const errStatus = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode;
        const shouldReconnect = errStatus !== DisconnectReason.loggedOut;
        console.log(
          `WhatsApp channel closed channel=${channelId} status=${errStatus ?? 'unknown'} reconnect=${shouldReconnect}`,
        );

        const event: ChannelDisconnectedEvent = {
          channelId,
          orgId,
          reason: String(errStatus ?? 'unknown'),
          disconnectedAt: new Date().toISOString(),
        };
        await db
          .update(channels)
          .set({ status: 'disconnected', updatedAt: new Date() })
          .where(and(eq(channels.id, channelId), eq(channels.orgId, orgId)));
        await this.redis.publish(REDIS_CHANNELS.channelDisconnected, JSON.stringify(event));

        this.sockets.delete(channelId);

        if (shouldReconnect) {
          setTimeout(() => {
            this.open(channelId, orgId).catch(console.error);
          }, 5000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      if (type !== 'notify') return;

      for (const msg of msgs) {
        if (!msg.message || msg.key.fromMe) continue;

        const from = msg.key.remoteJid ?? '';
        const content = await extractContent(msg);
        if (!content) continue;

        const event: InboundMessageEvent = {
          channelId,
          orgId,
          externalMessageId: msg.key.id ?? '',
          from,
          receivedAt: new Date().toISOString(),
          content,
        };
        await this.redis.publish(REDIS_CHANNELS.inboundMessage, JSON.stringify(event));
      }
    });

    sock.ev.on('message-receipt.update', async (updates) => {
      for (const update of updates) {
        const status = update.receipt?.readTimestamp ? 'read' : 'delivered';
        const event: MessageStatusEvent = {
          channelId,
          orgId,
          externalMessageId: update.key.id ?? '',
          status,
          occurredAt: new Date().toISOString(),
        };
        await this.redis.publish(REDIS_CHANNELS.messageStatus, JSON.stringify(event));
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (!update.key.fromMe || !update.key.id || update.update.status == null) continue;

        const status = messageStatusToStatus(update.update.status);
        if (!status) continue;

        const event: MessageStatusEvent = {
          channelId,
          orgId,
          externalMessageId: update.key.id,
          status,
          occurredAt: new Date().toISOString(),
        };
        await this.redis.publish(REDIS_CHANNELS.messageStatus, JSON.stringify(event));
      }
    });
  }

  async send(channelId: string, to: string, content: ChannelMessageContent): Promise<string> {
    const entry = this.sockets.get(channelId);
    if (!entry) throw new Error(`No active socket for channel ${channelId}`);

    const jid = toWaJid(to);
    console.log(`Sending WhatsApp message channel=${channelId} to=${jid}`);

    if (content.kind === 'text') {
      const result = await entry.socket.sendMessage(jid, { text: content.text });
      return result?.key?.id ?? `msg_${Date.now()}`;
    }

    if (content.kind === 'media') {
      const result = await entry.socket.sendMessage(jid, {
        image: { url: content.mediaUrl },
        ...(content.caption !== undefined && { caption: content.caption }),
        ...(content.mimeType !== undefined && { mimetype: content.mimeType }),
      });
      return result?.key?.id ?? `msg_${Date.now()}`;
    }

    throw new Error(`Unsupported content kind: ${(content as { kind: string }).kind}`);
  }

  async close(channelId: string): Promise<void> {
    const entry = this.sockets.get(channelId);
    if (!entry) return;
    try {
      entry.socket.end(new Error('Restarting WhatsApp pairing socket'));
    } finally {
      this.sockets.delete(channelId);
    }
  }

  isOpen(channelId: string): boolean {
    return this.sockets.has(channelId);
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.sockets.keys()).map((id) => this.close(id)),
    );
  }
}

async function extractContent(msg: proto.IWebMessageInfo): Promise<ChannelMessageContent | null> {
  const m = msg.message;
  if (!m) return null;

  if (m.conversation) {
    return { kind: 'text', text: m.conversation };
  }
  if (m.extendedTextMessage?.text) {
    return { kind: 'text', text: m.extendedTextMessage.text };
  }
  if (m.imageMessage) {
    return {
      kind: 'media',
      mediaUrl: '',
      ...(m.imageMessage.caption != null && { caption: m.imageMessage.caption }),
      ...(m.imageMessage.mimetype != null && { mimeType: m.imageMessage.mimetype }),
    };
  }
  if (m.documentMessage) {
    return {
      kind: 'media',
      mediaUrl: '',
      ...(m.documentMessage.mimetype != null && { mimeType: m.documentMessage.mimetype }),
    };
  }
  if (m.audioMessage) {
    const mediaBase64 = await downloadMessageMedia(m.audioMessage, 'audio');
    if (!mediaBase64) return null;

    return {
      kind: 'audio',
      mediaBase64,
      ...(m.audioMessage.mimetype != null && { mimeType: m.audioMessage.mimetype }),
      ...(m.audioMessage.seconds != null && { seconds: Number(m.audioMessage.seconds) }),
    };
  }
  return null;
}

async function downloadMessageMedia(
  message: proto.IMessage['audioMessage'],
  type: 'audio',
) {
  if (!message) return null;

  const stream = await downloadContentFromMessage(message, type);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('base64');
}

function messageStatusToStatus(raw: proto.WebMessageInfo.Status): MessageStatusEvent['status'] | null {
  switch (raw) {
    case proto.WebMessageInfo.Status.SERVER_ACK:
      return 'sent';
    case proto.WebMessageInfo.Status.DELIVERY_ACK:
      return 'delivered';
    case proto.WebMessageInfo.Status.READ:
    case proto.WebMessageInfo.Status.PLAYED:
      return 'read';
    case proto.WebMessageInfo.Status.ERROR:
      return 'failed';
    default:
      return null;
  }
}

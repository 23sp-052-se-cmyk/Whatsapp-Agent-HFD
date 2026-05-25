import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { db, channels, eq, messages } from '@repo/db';
import {
  type MessageStatusEvent,
  type OutboundMessageJob,
  QUEUE_NAMES,
  REDIS_CHANNELS,
} from '@repo/shared';
import { SocketRegistry } from './socket-registry';
import { BaileysProvider } from './providers/baileys.provider';

async function bootstrap() {
  console.log('Channel worker starting...');

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const registry = new SocketRegistry(redis);
  const provider = new BaileysProvider(registry);

  await subscriber.subscribe(REDIS_CHANNELS.messageStatus);
  subscriber.on('message', (_channel, payload) => {
    handleMessageStatus(payload).catch((err) => {
      console.error('Failed to handle message status:', err.message);
    });
  });

  // Open sockets for all channels that are already connected
  const connectedChannels = await db
    .select({ id: channels.id, orgId: channels.orgId })
    .from(channels)
    .where(eq(channels.status, 'connected'));

  console.log(`Restoring ${connectedChannels.length} connected channel(s)...`);
  await Promise.allSettled(
    connectedChannels.map((ch) => provider.openChannel(ch.id, ch.orgId)),
  );

  // Outbound message worker
  const outboundWorker = new Worker(
    QUEUE_NAMES.outbound,
    async (job) => {
      const data = job.data as OutboundMessageJob;
      console.log(`Sending outbound message [job=${job.id}] channel=${data.channelId}`);

      const externalId = await provider.sendMessage(
        data.channelId,
        data.to,
        data.content,
      );
      await db
        .update(messages)
        .set({ status: 'sent', waMessageId: externalId })
        .where(eq(messages.id, data.messageId));

      return { externalId };
    },
    { connection: redis },
  );

  // Pair-channel worker: opens a new Baileys socket to stream QR codes
  const pairWorker = new Worker(
    QUEUE_NAMES.pairChannel,
    async (job) => {
      const { channelId, orgId, phone } = job.data as {
        channelId: string;
        orgId: string;
        phone?: string;
      };
      console.log(`Starting pairing for channel=${channelId}`);
      await provider.closeChannel(channelId).catch((err) => {
        console.warn(`Failed to close existing socket before pairing channel=${channelId}:`, err.message);
      });
      await provider.openChannel(channelId, orgId, phone);
    },
    { connection: redis },
  );

  outboundWorker.on('failed', (job, err) => {
    console.error(`Outbound job ${job?.id} failed:`, err.message);
    const data = job?.data as Partial<OutboundMessageJob> | undefined;
    if (data?.messageId) {
      db.update(messages)
        .set({ status: 'failed' })
        .where(eq(messages.id, data.messageId))
        .catch((updateErr) => {
          console.error(`Failed to mark message ${data.messageId} failed:`, updateErr.message);
        });
    }
  });

  pairWorker.on('failed', (job, err) => {
    console.error(`Pair job ${job?.id} failed:`, err.message);
  });

  async function shutdown(signal: string) {
    console.log(`${signal} received — shutting down...`);
    await outboundWorker.close();
    await pairWorker.close();
    await subscriber.quit();
    await registry.closeAll();
    await redis.quit();
    process.exit(0);
  }

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(console.error); });
  process.on('SIGINT', () => { shutdown('SIGINT').catch(console.error); });

  console.log('Channel worker ready.');
}

async function handleMessageStatus(payload: string) {
  const event = JSON.parse(payload) as MessageStatusEvent;
  if (!event.externalMessageId) return;

  await db
    .update(messages)
    .set({ status: event.status })
    .where(eq(messages.waMessageId, event.externalMessageId));
}

bootstrap().catch((err) => {
  console.error('Failed to start channel worker:', err);
  process.exit(1);
});

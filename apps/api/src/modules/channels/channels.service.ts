import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { and, asc, channels, db, eq } from '@repo/db';
import { QUEUE_NAMES } from '@repo/shared';

type LatestQr = {
  channelId: string;
  orgId: string;
  qr: string;
  generatedAt: string;
};

type LatestPairCode = {
  channelId: string;
  orgId: string;
  phone: string;
  code: string;
  generatedAt: string;
};

@Injectable()
export class ChannelsService implements OnModuleDestroy {
  private readonly redis: IORedis;
  private readonly pairQueue: Queue;

  constructor(config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.pairQueue = new Queue(QUEUE_NAMES.pairChannel, {
      connection: this.redis,
    });
  }

  async onModuleDestroy() {
    await this.pairQueue.close();
    await this.redis.quit();
  }

  async findAll(orgId: string) {
    return db
      .select()
      .from(channels)
      .where(eq(channels.orgId, orgId))
      .orderBy(asc(channels.createdAt));
  }

  async create(orgId: string, phone?: string) {
    const [channel] = await db
      .insert(channels)
      .values({
        orgId,
        phone: phone?.trim() || 'not-paired',
        provider: 'baileys',
        status: 'disconnected',
      })
      .returning();

    if (!channel) throw new Error('Failed to create channel');
    return channel;
  }

  async findOne(orgId: string, id: string) {
    const channel = await this.getOwnedChannel(orgId, id);
    return channel;
  }

  async remove(orgId: string, id: string) {
    await this.getOwnedChannel(orgId, id);
    await this.redis.del(`channels:${id}:latest-qr`);
    await db
      .delete(channels)
      .where(and(eq(channels.id, id), eq(channels.orgId, orgId)));
  }

  async pair(orgId: string, id: string) {
    const channel = await this.getOwnedChannel(orgId, id);

    await db
      .update(channels)
      .set({ status: 'reconnecting', updatedAt: new Date() })
      .where(and(eq(channels.id, id), eq(channels.orgId, orgId)));

    await this.pairQueue.add(
      `pair-${id}-${Date.now()}`,
      { channelId: id, orgId },
      {
        removeOnComplete: true,
        removeOnFail: 25,
        attempts: 1,
      },
    );

    return {
      ...channel,
      status: 'reconnecting',
      pairing: true,
      message: 'Pairing started. Refresh QR for the next two minutes.',
    };
  }

  async pairWithCode(orgId: string, id: string, phone: string) {
    const channel = await this.getOwnedChannel(orgId, id);
    const normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone) throw new Error('Phone number is required');

    await this.redis.del(`channels:${id}:latest-pair-code`);

    await db
      .update(channels)
      .set({ status: 'reconnecting', updatedAt: new Date() })
      .where(and(eq(channels.id, id), eq(channels.orgId, orgId)));

    await this.pairQueue.add(
      `pair-code-${id}-${Date.now()}`,
      { channelId: id, orgId, phone: normalizedPhone },
      {
        removeOnComplete: true,
        removeOnFail: 25,
        attempts: 1,
      },
    );

    return {
      ...channel,
      status: 'reconnecting',
      pairing: true,
      message: 'Pairing code requested. Check code after a few seconds.',
    };
  }

  async getLatestPairCode(orgId: string, id: string) {
    await this.getOwnedChannel(orgId, id);
    const raw = await this.redis.get(`channels:${id}:latest-pair-code`);
    if (!raw) {
      return { channelId: id, phone: null, code: null, generatedAt: null };
    }

    const event = JSON.parse(raw) as LatestPairCode;
    if (event.orgId !== orgId) {
      throw new NotFoundException('Channel not found');
    }

    return {
      channelId: event.channelId,
      phone: event.phone,
      code: event.code,
      generatedAt: event.generatedAt,
    };
  }

  async getLatestQr(orgId: string, id: string) {
    await this.getOwnedChannel(orgId, id);
    const raw = await this.redis.get(`channels:${id}:latest-qr`);
    if (!raw) {
      return { channelId: id, qr: null, generatedAt: null };
    }

    const event = JSON.parse(raw) as LatestQr;
    if (event.orgId !== orgId) {
      throw new NotFoundException('Channel not found');
    }

    return {
      channelId: event.channelId,
      qr: event.qr,
      generatedAt: event.generatedAt,
    };
  }

  private async getOwnedChannel(orgId: string, id: string) {
    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.orgId, orgId)))
      .limit(1);

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }
}

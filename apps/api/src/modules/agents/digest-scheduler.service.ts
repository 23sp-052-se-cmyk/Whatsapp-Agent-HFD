import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  and,
  asc,
  channels,
  contacts,
  conversations,
  db,
  desc,
  digestSchedules,
  eq,
  gte,
  messages,
  not,
} from '@repo/db';
import { QUEUE_NAMES } from '@repo/shared';
import type { OutboundMessageJob } from '@repo/shared';

const ADMIN_DIGEST_STAGE = 'admin_digest';
const DEFAULT_TIMEZONE = 'Asia/Karachi';

@Injectable()
export class DigestSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestSchedulerService.name);
  private readonly redis: IORedis;
  private readonly outboundQueue: Queue;
  private interval?: NodeJS.Timeout;
  private running = false;

  constructor(config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.outboundQueue = new Queue(QUEUE_NAMES.outbound, {
      connection: this.redis,
    });
  }

  onModuleInit() {
    this.interval = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error(`Digest scheduler failed: ${err.message}`, err.stack);
      });
    }, 60_000);

    this.tick().catch((err) => {
      this.logger.error(`Initial digest scheduler check failed: ${err.message}`, err.stack);
    });
  }

  async onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
    await this.outboundQueue.close();
    await this.redis.quit();
  }

  private async tick() {
    if (this.running) return;
    this.running = true;

    try {
      const now = new Date();
      const schedules = await db.select().from(digestSchedules).orderBy(asc(digestSchedules.createdAt));

      for (const schedule of schedules) {
        if (!schedule.channels.includes('whatsapp')) continue;
        if (!schedule.recipientPhone) continue;
        if (!isScheduleDue(schedule, now)) continue;

        await this.sendDigest(schedule, now);
      }
    } finally {
      this.running = false;
    }
  }

  private async sendDigest(
    schedule: typeof digestSchedules.$inferSelect,
    now: Date,
  ) {
    const recipientPhone = schedule.recipientPhone;
    if (!recipientPhone) return;

    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.orgId, schedule.orgId), eq(channels.status, 'connected')))
      .orderBy(desc(channels.updatedAt))
      .limit(1);

    if (!channel) {
      this.logger.warn(`Skipping digest ${schedule.id}: no connected WhatsApp channel`);
      return;
    }

    const since = schedule.lastRunAt ?? getPeriodStart(schedule.frequency, now);
    const summary = await buildDigestMessage(schedule.orgId, since, now);
    const waId = normalizeWaId(recipientPhone);

    let [contact] = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.orgId, schedule.orgId),
          eq(contacts.channelId, channel.id),
          eq(contacts.waId, waId),
        ),
      )
      .limit(1);

    if (!contact) {
      [contact] = await db
        .insert(contacts)
        .values({
          orgId: schedule.orgId,
          channelId: channel.id,
          waId,
          name: 'Admin summary',
        })
        .returning();
    }
    if (!contact) throw new Error('Failed to create digest contact');

    let [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.orgId, schedule.orgId),
          eq(conversations.channelId, channel.id),
          eq(conversations.contactId, contact.id),
        ),
      )
      .limit(1);

    if (!conversation) {
      [conversation] = await db
        .insert(conversations)
        .values({
          orgId: schedule.orgId,
          channelId: channel.id,
          contactId: contact.id,
          state: 'open',
          pipelineStage: ADMIN_DIGEST_STAGE,
          aiMode: 'off',
          lastMsgAt: now,
        })
        .returning();
    }
    if (!conversation) throw new Error('Failed to create digest conversation');

    const [message] = await db
      .insert(messages)
      .values({
        orgId: schedule.orgId,
        conversationId: conversation.id,
        direction: 'outbound',
        type: 'text',
        body: summary,
        status: 'pending',
      })
      .returning();
    if (!message) throw new Error('Failed to create digest message');

    await db
      .update(conversations)
      .set({ lastMsgAt: now, updatedAt: now })
      .where(eq(conversations.id, conversation.id));

    await this.outboundQueue.add(
      `digest-${schedule.id}-${now.getTime()}`,
      {
        channelId: channel.id,
        orgId: schedule.orgId,
        conversationId: conversation.id,
        messageId: message.id,
        to: waId,
        content: { kind: 'text', text: summary },
      } satisfies OutboundMessageJob,
      {
        removeOnComplete: true,
        removeOnFail: 25,
        attempts: 1,
      },
    );

    await db
      .update(digestSchedules)
      .set({ lastRunAt: now, updatedAt: now })
      .where(eq(digestSchedules.id, schedule.id));

    this.logger.log(`Queued ${schedule.frequency} digest ${schedule.id} to ${waId}`);
  }
}

async function buildDigestMessage(orgId: string, since: Date, now: Date) {
  const newLeadRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.orgId, orgId),
        gte(conversations.createdAt, since),
        not(eq(conversations.pipelineStage, ADMIN_DIGEST_STAGE)),
      ),
    );

  const messageSummaryRows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(messages.orgId, orgId),
        gte(messages.createdAt, since),
        not(eq(conversations.pipelineStage, ADMIN_DIGEST_STAGE)),
      ),
    );

  const recentMessageRows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      body: messages.body,
      createdAt: messages.createdAt,
      contactName: contacts.name,
      waId: contacts.waId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(messages.orgId, orgId),
        gte(messages.createdAt, since),
        not(eq(conversations.pipelineStage, ADMIN_DIGEST_STAGE)),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(5);

  const inboundCount = messageSummaryRows.filter((message) => message.direction === 'inbound').length;
  const outboundCount = messageSummaryRows.filter((message) => message.direction === 'outbound').length;
  const recentLines = recentMessageRows.map((message, index) => {
    const contactLabel = message.contactName || cleanWaId(message.waId);
    const body = (message.body ?? '').replace(/\s+/g, ' ').trim();
    const preview = body.length > 80 ? `${body.slice(0, 77)}...` : body || '(media/update)';
    return `${index + 1}. ${contactLabel}: ${preview}`;
  });

  return [
    'WhatsApp business update',
    `${formatDateTime(since)} - ${formatDateTime(now)}`,
    '',
    `New leads: ${newLeadRows.length}`,
    `Conversation messages: ${messageSummaryRows.length}`,
    `Inbound: ${inboundCount}`,
    `Outbound: ${outboundCount}`,
    '',
    recentLines.length > 0 ? 'Recent conversations:' : 'Recent conversations: none',
    ...recentLines,
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

function isScheduleDue(
  schedule: typeof digestSchedules.$inferSelect,
  now: Date,
) {
  const timezone = schedule.timezone || DEFAULT_TIMEZONE;
  const currentTime = formatTime(now, timezone);
  if (currentTime !== schedule.sendTime) return false;
  if (!schedule.lastRunAt) return true;

  if (schedule.frequency === 'daily') {
    return formatDate(schedule.lastRunAt, timezone) !== formatDate(now, timezone);
  }

  if (schedule.frequency === 'weekly') {
    return daysBetween(schedule.lastRunAt, now) >= 7;
  }

  return formatMonth(schedule.lastRunAt, timezone) !== formatMonth(now, timezone);
}

function getPeriodStart(frequency: 'daily' | 'weekly' | 'monthly', now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (frequency === 'weekly') {
    start.setDate(start.getDate() - 7);
  } else if (frequency === 'monthly') {
    start.setMonth(start.getMonth() - 1);
  }

  return start;
}

function normalizeWaId(input: string) {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

function cleanWaId(waId: string) {
  return waId.replace(/@s\.whatsapp\.net$/i, '').replace(/@c\.us$/i, '');
}

function formatTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatMonth(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}

function daysBetween(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

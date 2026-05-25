import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
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
  eq,
  messages,
} from '@repo/db';
import { QUEUE_NAMES } from '@repo/shared';
import type { SendMessageDto } from './dto/send-message.dto';
import type { UpdateConversationDto } from './dto/update-conversation.dto';

interface CreateConversationDto {
  channelId: string;
  waId: string;
  name?: string | undefined;
}

@Injectable()
export class ConversationsService implements OnModuleDestroy {
  private readonly redis: IORedis;
  private readonly outboundQueue: Queue;

  constructor(config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.outboundQueue = new Queue(QUEUE_NAMES.outbound, {
      connection: this.redis,
    });
  }

  async onModuleDestroy() {
    await this.outboundQueue.close();
    await this.redis.quit();
  }

  async findAll(orgId: string, channelId?: string) {
    const filters = [eq(conversations.orgId, orgId)];
    if (channelId) filters.push(eq(conversations.channelId, channelId));

    return db
      .select({
        id: conversations.id,
        orgId: conversations.orgId,
        channelId: conversations.channelId,
        contactId: conversations.contactId,
        state: conversations.state,
        pipelineStage: conversations.pipelineStage,
        assignedMemberId: conversations.assignedMemberId,
        aiMode: conversations.aiMode,
        lastMsgAt: conversations.lastMsgAt,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        contact: {
          id: contacts.id,
          waId: contacts.waId,
          name: contacts.name,
          consentStatus: contacts.consentStatus,
        },
        channel: {
          id: channels.id,
          phone: channels.phone,
          status: channels.status,
          provider: channels.provider,
        },
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .innerJoin(channels, eq(conversations.channelId, channels.id))
      .where(and(...filters))
      .orderBy(desc(conversations.lastMsgAt), desc(conversations.createdAt));
  }

  async create(orgId: string, dto: CreateConversationDto) {
    await this.getOwnedChannel(orgId, dto.channelId);
    const waId = normalizeWaId(dto.waId);

    let [contact] = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.orgId, orgId),
          eq(contacts.channelId, dto.channelId),
          eq(contacts.waId, waId),
        ),
      )
      .limit(1);

    if (!contact) {
      [contact] = await db
        .insert(contacts)
        .values({
          orgId,
          channelId: dto.channelId,
          waId,
          name: dto.name?.trim() || null,
        })
        .returning();
    }
    if (!contact) throw new Error('Failed to create contact');

    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.orgId, orgId),
          eq(conversations.channelId, dto.channelId),
          eq(conversations.contactId, contact.id),
        ),
      )
      .limit(1);

    if (existing) return this.findOne(orgId, existing.id);

    const now = new Date();
    const [conversation] = await db
      .insert(conversations)
      .values({
        orgId,
        channelId: dto.channelId,
        contactId: contact.id,
        state: 'open',
        pipelineStage: 'new',
        aiMode: 'auto',
        lastMsgAt: now,
      })
      .returning();
    if (!conversation) throw new Error('Failed to create conversation');

    await db.insert(messages).values({
      orgId,
      conversationId: conversation.id,
      direction: 'inbound',
      type: 'text',
      body: 'Demo conversation created. Send a reply from this screen.',
      status: 'delivered',
    });

    return this.findOne(orgId, conversation.id);
  }

  async findOne(orgId: string, id: string) {
    const [found] = await db
      .select({
        id: conversations.id,
        orgId: conversations.orgId,
        channelId: conversations.channelId,
        contactId: conversations.contactId,
        state: conversations.state,
        pipelineStage: conversations.pipelineStage,
        assignedMemberId: conversations.assignedMemberId,
        aiMode: conversations.aiMode,
        lastMsgAt: conversations.lastMsgAt,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        contact: {
          id: contacts.id,
          waId: contacts.waId,
          name: contacts.name,
          consentStatus: contacts.consentStatus,
        },
        channel: {
          id: channels.id,
          phone: channels.phone,
          status: channels.status,
          provider: channels.provider,
        },
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .innerJoin(channels, eq(conversations.channelId, channels.id))
      .where(and(eq(conversations.id, id), eq(conversations.orgId, orgId)))
      .limit(1);

    if (!found) throw new NotFoundException('Conversation not found');
    return found;
  }

  async update(orgId: string, id: string, dto: UpdateConversationDto) {
    await this.getOwnedConversation(orgId, id);
    const updateValues: {
      state?: 'open' | 'resolved' | 'archived';
      pipelineStage?: string;
      aiMode?: 'auto' | 'paused' | 'off';
      assignedMemberId?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (dto.state !== undefined) updateValues.state = dto.state;
    if (dto.pipelineStage !== undefined) updateValues.pipelineStage = dto.pipelineStage;
    if (dto.aiMode !== undefined) updateValues.aiMode = dto.aiMode;
    if (dto.assignedMemberId !== undefined) {
      updateValues.assignedMemberId = dto.assignedMemberId;
    }

    const [updated] = await db
      .update(conversations)
      .set(updateValues)
      .where(and(eq(conversations.id, id), eq(conversations.orgId, orgId)))
      .returning();
    if (!updated) throw new NotFoundException('Conversation not found');

    return this.findOne(orgId, updated.id);
  }

  async findMessages(orgId: string, id: string) {
    await this.getOwnedConversation(orgId, id);

    return db
      .select()
      .from(messages)
      .where(and(eq(messages.orgId, orgId), eq(messages.conversationId, id)))
      .orderBy(asc(messages.createdAt));
  }

  async sendMessage(orgId: string, id: string, dto: SendMessageDto) {
    const conversation = await this.getOwnedConversation(orgId, id);
    const channel = await this.getOwnedChannel(orgId, conversation.channelId);
    if (channel.status !== 'connected') {
      throw new BadRequestException(
        'WhatsApp channel is not connected. Pair the channel before sending messages.',
      );
    }
    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, conversation.contactId), eq(contacts.orgId, orgId)))
      .limit(1);

    if (!contact) throw new NotFoundException('Contact not found');

    const now = new Date();
    const [message] = await db
      .insert(messages)
      .values({
        orgId,
        conversationId: id,
        direction: 'outbound',
        type: dto.kind === 'text' ? 'text' : 'image',
        body: dto.kind === 'text' ? dto.text : dto.caption ?? null,
        mediaRef: dto.kind === 'media' ? dto.mediaUrl : null,
        status: 'pending',
      })
      .returning();
    if (!message) throw new Error('Failed to create message');

    await db
      .update(conversations)
      .set({ lastMsgAt: now, updatedAt: now })
      .where(and(eq(conversations.id, id), eq(conversations.orgId, orgId)));

    await this.outboundQueue.add(
      `outbound-${message.id}`,
      {
        channelId: conversation.channelId,
        orgId,
        conversationId: id,
        messageId: message.id,
        to: contact.waId,
        content: dto,
      },
      {
        removeOnComplete: true,
        removeOnFail: 25,
        attempts: 1,
      },
    );

    return message;
  }

  private async getOwnedChannel(orgId: string, id: string) {
    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.orgId, orgId)))
      .limit(1);

    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  private async getOwnedConversation(orgId: string, id: string) {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.orgId, orgId)))
      .limit(1);

    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}

function normalizeWaId(input: string) {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  agentConfigs,
  and,
  channels,
  contacts,
  conversations,
  db,
  desc,
  eq,
  messages,
  not,
} from '@repo/db';
import { QUEUE_NAMES, type OutboundMessageJob } from '@repo/shared';

const ADMIN_DIGEST_STAGE = 'admin_digest';
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_FOLLOW_UP_DELAYS_MINUTES = [120, 1440, 2880];

@Injectable()
export class ProactiveFollowupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProactiveFollowupService.name);
  private readonly redis: IORedis;
  private readonly outboundQueue: Queue;
  private readonly intervalMs: number;
  private readonly delaysMinutes: number[];
  private readonly maxFollowups: number;
  private interval?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.outboundQueue = new Queue(QUEUE_NAMES.outbound, {
      connection: this.redis,
    });
    this.intervalMs = numberEnv(config, 'PROACTIVE_FOLLOWUP_INTERVAL_MS', DEFAULT_INTERVAL_MS);
    this.delaysMinutes = listEnv(
      config,
      'PROACTIVE_FOLLOWUP_DELAYS_MINUTES',
      DEFAULT_FOLLOW_UP_DELAYS_MINUTES,
    );
    this.maxFollowups = Math.max(0, this.delaysMinutes.length);
  }

  onModuleInit() {
    this.interval = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error(`Proactive follow-up failed: ${err.message}`, err.stack);
      });
    }, this.intervalMs);

    this.tick().catch((err) => {
      this.logger.error(`Initial proactive follow-up failed: ${err.message}`, err.stack);
    });
  }

  async onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
    await this.outboundQueue.close();
    await this.redis.quit();
  }

  private async tick() {
    if (this.running || this.maxFollowups === 0) return;
    this.running = true;

    try {
      const candidates = await db
        .select({
          conversationId: conversations.id,
          orgId: conversations.orgId,
          channelId: conversations.channelId,
          contactId: conversations.contactId,
          pipelineStage: conversations.pipelineStage,
          contactName: contacts.name,
          waId: contacts.waId,
        })
        .from(conversations)
        .innerJoin(channels, eq(conversations.channelId, channels.id))
        .innerJoin(contacts, eq(conversations.contactId, contacts.id))
        .where(
          and(
            eq(conversations.state, 'open'),
            eq(conversations.aiMode, 'auto'),
            eq(channels.status, 'connected'),
            not(eq(conversations.pipelineStage, ADMIN_DIGEST_STAGE)),
          ),
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(200);

      for (const candidate of candidates) {
        await this.maybeFollowUp(candidate);
      }
    } finally {
      this.running = false;
    }
  }

  private async maybeFollowUp(candidate: FollowupCandidate) {
    const historyRows = await db
      .select({
        id: messages.id,
        direction: messages.direction,
        body: messages.body,
        transcript: messages.transcript,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.orgId, candidate.orgId),
          eq(messages.conversationId, candidate.conversationId),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(20);

    const newest = historyRows[0];
    if (!newest || newest.direction !== 'outbound') return;

    const consecutiveOutbound = countConsecutiveOutbound(historyRows);
    if (consecutiveOutbound >= this.maxFollowups + 1) return;

    const followupNumber = consecutiveOutbound;
    const requiredDelay = this.delaysMinutes[followupNumber - 1] ?? this.delaysMinutes.at(-1);
    if (!requiredDelay) return;

    const idleMinutes = (Date.now() - newest.createdAt.getTime()) / 60_000;
    if (idleMinutes < requiredDelay) return;

    const orderedHistory = historyRows
      .reverse()
      .map((row) => ({
        role: row.direction === 'inbound' ? 'customer' as const : 'assistant' as const,
        text: (row.transcript || row.body || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((row) => row.text.length > 0);

    const text = await this.generateFollowup(candidate.orgId, orderedHistory, followupNumber);
    if (!text) return;

    const now = new Date();
    const [message] = await db
      .insert(messages)
      .values({
        orgId: candidate.orgId,
        conversationId: candidate.conversationId,
        direction: 'outbound',
        type: 'text',
        body: text,
        status: 'pending',
        createdAt: now,
      })
      .returning();
    if (!message) return;

    await db
      .update(conversations)
      .set({ lastMsgAt: now, updatedAt: now })
      .where(eq(conversations.id, candidate.conversationId));

    await this.outboundQueue.add(
      `proactive-followup-${message.id}`,
      {
        channelId: candidate.channelId,
        orgId: candidate.orgId,
        conversationId: candidate.conversationId,
        messageId: message.id,
        to: candidate.waId,
        content: { kind: 'text', text },
      } satisfies OutboundMessageJob,
      {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 25,
      },
    );

    this.logger.log(
      `Queued proactive follow-up ${followupNumber}/${this.maxFollowups} for ${candidate.conversationId}`,
    );
  }

  private async generateFollowup(
    orgId: string,
    history: Array<{ role: 'customer' | 'assistant'; text: string }>,
    followupNumber: number,
  ) {
    const [agent] = await db
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.orgId, orgId), eq(agentConfigs.status, 'published')))
      .orderBy(desc(agentConfigs.version), desc(agentConfigs.createdAt))
      .limit(1);

    const provider = getAiProvider(this.config);
    const agentPrompt = buildAgentPrompt(agent);
    if (provider) {
      const aiText = await generateAiFollowup(provider, agentPrompt, history, followupNumber);
      if (aiText) return cleanFollowup(aiText);
    }

    return buildLocalFollowup(agentPrompt, history, followupNumber);
  }
}

type FollowupCandidate = {
  conversationId: string;
  orgId: string;
  channelId: string;
  contactId: string;
  pipelineStage: string;
  contactName: string | null;
  waId: string;
};

type AiProvider = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function countConsecutiveOutbound(
  historyRows: Array<{ direction: 'inbound' | 'outbound' }>,
) {
  let count = 0;
  for (const row of historyRows) {
    if (row.direction !== 'outbound') break;
    count += 1;
  }
  return count;
}

function getAiProvider(config: ConfigService): AiProvider | null {
  const groqKey = config.get<string>('GROQ_API_KEY')?.trim();
  if (!groqKey) return null;
  return {
    apiKey: groqKey,
    baseUrl: config.get<string>('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1',
    model: config.get<string>('GROQ_MODEL') || 'llama-3.3-70b-versatile',
  };
}

async function generateAiFollowup(
  provider: AiProvider,
  agentPrompt: string,
  history: Array<{ role: 'customer' | 'assistant'; text: string }>,
  followupNumber: number,
) {
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role: 'system',
            content: [
              agentPrompt,
              'Write one proactive WhatsApp follow-up to help close the lead.',
              'Do not answer an old question again. Do not repeat the previous assistant message.',
              'Ask exactly one useful next question or offer one clear next step.',
              'Use the same language/style as the customer.',
              'Be polite, natural, and concise. Maximum 2 short sentences.',
              `This is follow-up number ${followupNumber}.`,
              `Recent conversation:\n${formatHistory(history)}`,
            ].join('\n'),
          },
          {
            role: 'user',
            content: 'Generate the next proactive follow-up message only.',
          },
        ],
        temperature: 0.35,
        max_tokens: 120,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

function buildAgentPrompt(agent: {
  personaJson: unknown;
  rulesJson: unknown;
  replyLangPolicy: string;
} | null | undefined) {
  const persona = isRecord(agent?.personaJson) ? agent.personaJson : {};
  const rules = isRecord(agent?.rulesJson) ? agent.rulesJson : {};
  const businessName = stringValue(persona['businessName']);
  const customPrompt = stringValue(persona['systemPrompt']);
  const tone = stringValue(persona['tone']) || 'friendly, helpful, and practical';
  const guardrails = stringValue(rules['guardrails']);

  return [
    customPrompt || 'You are a WhatsApp business assistant helping convert leads.',
    businessName ? `Business name: ${businessName}` : '',
    `Tone: ${tone}`,
    `Reply language policy: ${agent?.replyLangPolicy ?? 'auto'}`,
    guardrails ? `Important rules: ${guardrails}` : '',
  ].filter(Boolean).join('\n');
}

function buildLocalFollowup(
  agentPrompt: string,
  history: Array<{ role: 'customer' | 'assistant'; text: string }>,
  followupNumber: number,
) {
  const customerText = history.filter((turn) => turn.role === 'customer').at(-1)?.text ?? '';
  const romanUrdu = isRomanUrdu(customerText) || agentPrompt.toLowerCase().includes('roman_urdu');
  const softer = followupNumber >= 2;

  if (romanUrdu) {
    return softer
      ? 'Ji, kya ap isay proceed karna chahenge ya main apko koi aur option suggest kar doon?'
      : 'Ji, kya ap is option me interested hain? Ap bata dein to main next step guide kar deta hoon.';
  }

  return softer
    ? 'Would you like to proceed with this, or should I suggest another option?'
    : 'Are you interested in this option? If yes, I can guide you with the next step.';
}

function cleanFollowup(text: string) {
  return text
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function formatHistory(history: Array<{ role: 'customer' | 'assistant'; text: string }>) {
  return history
    .slice(-10)
    .map((turn) => `${turn.role === 'customer' ? 'Customer' : 'Assistant'}: ${turn.text}`)
    .join('\n');
}

function numberEnv(config: ConfigService, key: string, fallback: number) {
  const parsed = Number(config.get<string>(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function listEnv(config: ConfigService, key: string, fallback: number[]) {
  const raw = config.get<string>(key);
  if (!raw) return fallback;
  const values = raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
  return values.length > 0 ? values : fallback;
}

function isRomanUrdu(text: string) {
  return /\b(kia|kya|hai|hain|hoti|hota|chahiye|bata|batayein|kitni|kab|shuru|mujhe|ap|aap|ji)\b/i.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

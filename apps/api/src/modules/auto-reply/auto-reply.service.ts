import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  and,
  asc,
  agentConfigs,
  channels,
  contacts,
  conversations,
  db,
  desc,
  eq,
  knowledgeChunks,
  messages,
} from '@repo/db';
import {
  type ChannelMessageContent,
  type InboundMessageEvent,
  QUEUE_NAMES,
  REDIS_CHANNELS,
} from '@repo/shared';

@Injectable()
export class AutoReplyService implements OnModuleInit, OnModuleDestroy {
  private readonly subscriber: IORedis;
  private readonly redis: IORedis;
  private readonly outboundQueue: Queue;

  constructor(private readonly config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.outboundQueue = new Queue(QUEUE_NAMES.outbound, {
      connection: this.redis,
    });
  }

  async onModuleInit() {
    await this.subscriber.subscribe(REDIS_CHANNELS.inboundMessage);
    this.subscriber.on('message', (_channel, payload) => {
      this.handleInbound(payload).catch((err) => {
        console.error('Auto-reply failed:', err);
      });
    });
    console.log('Auto-reply listener ready.');
  }

  async onModuleDestroy() {
    await this.subscriber.quit();
    await this.outboundQueue.close();
    await this.redis.quit();
  }

  private async handleInbound(payload: string) {
    const event = JSON.parse(payload) as InboundMessageEvent;
    const inboundText = await this.getInboundText(event.content);

    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, event.channelId), eq(channels.orgId, event.orgId)))
      .limit(1);
    if (!channel) return;

    const contact = await this.getOrCreateContact(event);
    const conversation = await this.getOrCreateConversation(event, contact.id);
    const voiceNotUnderstood =
      event.content.kind === 'audio' && !inboundText;

    const [existingInbound] = event.externalMessageId
      ? await db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.orgId, event.orgId),
              eq(messages.conversationId, conversation.id),
              eq(messages.waMessageId, event.externalMessageId),
            ),
          )
          .limit(1)
      : [];

    if (!existingInbound) {
      await db.insert(messages).values({
        orgId: event.orgId,
        conversationId: conversation.id,
        direction: 'inbound',
        type: event.content.kind === 'audio' ? 'audio' : 'text',
        body: inboundText || (voiceNotUnderstood ? '[voice note not understood]' : ''),
        transcript: event.content.kind === 'audio' ? inboundText || null : null,
        waMessageId: event.externalMessageId || null,
        status: 'delivered',
        createdAt: new Date(event.receivedAt),
      });
    }

    await db
      .update(conversations)
      .set({ lastMsgAt: new Date(event.receivedAt), updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));

    if (conversation.aiMode !== 'auto' || conversation.state !== 'open') return;

    const replyText = voiceNotUnderstood
      ? 'Maaf kijiye, main apki voice samajh nahi paa raha. Kia ap text message kar denge?'
      : await this.generateReply(
          event.orgId,
          conversation.id,
          inboundText,
          event.content.kind === 'audio',
        );
    const [reply] = await db
      .insert(messages)
      .values({
        orgId: event.orgId,
        conversationId: conversation.id,
        direction: 'outbound',
        type: 'text',
        body: replyText,
        status: 'pending',
      })
      .returning();
    if (!reply) return;

    const content: ChannelMessageContent = { kind: 'text', text: replyText };
    await this.outboundQueue.add(
      `auto-reply-${reply.id}`,
      {
        channelId: event.channelId,
        orgId: event.orgId,
        conversationId: conversation.id,
        messageId: reply.id,
        to: event.from,
        content,
      },
      {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 25,
      },
    );
  }

  private async getInboundText(content: ChannelMessageContent) {
    if (content.kind === 'text') return content.text.trim();
    if (content.kind === 'media') return content.caption?.trim() ?? '';
    if (content.kind === 'audio') {
      if (content.transcript?.trim()) return content.transcript.trim();

      const transcript = await this.transcribeAudio(content);
      if (transcript) return transcript;

      return '';
    }

    return '';
  }

  private async transcribeAudio(content: Extract<ChannelMessageContent, { kind: 'audio' }>) {
    const providers = getTranscriptionProviders(this.config);
    if (providers.length === 0) return null;

    const audioBuffer = Buffer.from(content.mediaBase64, 'base64');

    for (const provider of providers) {
      try {
        const form = new FormData();
        const blob = new Blob([audioBuffer], {
          type: content.mimeType || 'audio/ogg',
        });
        form.append('file', blob, `voice.${extensionFromMimeType(content.mimeType)}`);
        form.append('model', provider.model);

        form.append('response_format', 'json');
        form.append('temperature', '0');
        if (provider.language) form.append('language', provider.language);

        const response = await fetch(`${provider.baseUrl}/audio/${provider.task}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: form,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(
            `Audio transcription failed provider=${provider.name} status=${response.status} ${errorText.slice(0, 300)}`,
          );
          continue;
        }
        const data = (await response.json()) as { text?: string };
        const transcript = data.text?.trim();
        if (transcript) return transcript;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Audio transcription failed provider=${provider.name}: ${message}`);
      }
    }

    return null;
  }

  private async getOrCreateContact(event: InboundMessageEvent) {
    const [existing] = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.orgId, event.orgId),
          eq(contacts.channelId, event.channelId),
          eq(contacts.waId, event.from),
        ),
      )
      .limit(1);

    if (existing) return existing;

    const [created] = await db
      .insert(contacts)
      .values({
        orgId: event.orgId,
        channelId: event.channelId,
        waId: event.from,
        name: formatWaId(event.from),
      })
      .returning();

    if (!created) throw new Error('Failed to create contact');
    return created;
  }

  private async getOrCreateConversation(event: InboundMessageEvent, contactId: string) {
    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.orgId, event.orgId),
          eq(conversations.channelId, event.channelId),
          eq(conversations.contactId, contactId),
        ),
      )
      .limit(1);

    if (existing) return existing;

    const [created] = await db
      .insert(conversations)
      .values({
        orgId: event.orgId,
        channelId: event.channelId,
        contactId,
        state: 'open',
        pipelineStage: 'new',
        aiMode: 'auto',
        lastMsgAt: new Date(event.receivedAt),
      })
      .returning();

    if (!created) throw new Error('Failed to create conversation');
    return created;
  }

  private async generateReply(
    orgId: string,
    conversationId: string,
    userText: string,
    fromVoiceNote = false,
  ) {
    const [agent] = await db
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.orgId, orgId), eq(agentConfigs.status, 'published')))
      .orderBy(desc(agentConfigs.version), desc(agentConfigs.createdAt))
      .limit(1);

    const knowledge = await db
      .select({ text: knowledgeChunks.text })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.orgId, orgId))
      .orderBy(asc(knowledgeChunks.createdAt))
      .limit(20);

    const context = knowledge.map((item) => item.text).join('\n\n');
    const history = await this.getConversationHistory(orgId, conversationId, userText);
    const agentPrompt = buildAgentPrompt(agent);
    const aiProvider = getAiProvider(this.config);
    if (aiProvider) {
      const aiReply = await this.generateAiReply(
        aiProvider,
        userText,
        context,
        history,
        agentPrompt,
        fromVoiceNote,
      );
      if (aiReply) return aiReply;
    }

    return generateLocalReply(userText, context, agentPrompt, history);
  }

  private async getConversationHistory(
    orgId: string,
    conversationId: string,
    latestUserText: string,
  ): Promise<ConversationTurn[]> {
    const rows = await db
      .select({
        direction: messages.direction,
        body: messages.body,
        transcript: messages.transcript,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.orgId, orgId), eq(messages.conversationId, conversationId)))
      .orderBy(desc(messages.createdAt))
      .limit(14);

    const ordered = rows.reverse().map((row) => ({
      role: row.direction === 'inbound' ? 'customer' as const : 'assistant' as const,
      text: (row.transcript || row.body || '').replace(/\s+/g, ' ').trim(),
      createdAt: row.createdAt,
    })).filter((row) => row.text.length > 0);

    let latestIndex = -1;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const row = ordered[index];
      if (
        row?.role === 'customer' &&
        normalizeComparable(row.text) === normalizeComparable(latestUserText)
      ) {
        latestIndex = index;
        break;
      }
    }

    if (latestIndex >= 0) {
      ordered.splice(latestIndex, 1);
    }

    return ordered.slice(-12);
  }

  private async generateAiReply(
    provider: AiProvider,
    userText: string,
    context: string,
    history: ConversationTurn[],
    agentPrompt: string,
    fromVoiceNote: boolean,
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
                'Reply exactly as the customer should receive it on WhatsApp.',
                'The latest customer message is the question you must answer now.',
                'Use recent conversation history only as background for pronouns, missing references, remembered customer details, selected class/product/service, names, preferences, and unresolved needs.',
                'Do not answer an older question from history unless the latest message clearly asks about it.',
                'If the latest message starts a new topic, ignore older unrelated questions.',
                'Do not ask for information the customer already gave in the recent conversation unless it is ambiguous.',
                'Understand the latest customer question first, then synthesize a natural answer from the business knowledge.',
                'Use the Knowledge Base for facts, but do not copy raw training text or full documents.',
                'For WhatsApp, answer in 1-3 short sentences. Avoid long lists unless the customer asks for details.',
                'After answering, ask one short lead-closing next question when useful, such as class, branch, visit, timing, or admission next step.',
                'If the latest customer message is only punctuation or unclear, do not restart the greeting. Ask which detail they need next based on the recent conversation.',
                'If the Knowledge Base implies the answer, explain it clearly. Example: if admissions are open, answer that admissions are open now.',
                'If the exact detail is missing, say it is not mentioned and ask one short useful follow-up.',
                'Keep the reply concise, human, and in the customer language.',
                fromVoiceNote
                  ? 'The latest customer message came from a voice note. Reply only in English or Roman Urdu. Never reply in Urdu/Arabic script or any other language/script.'
                  : 'Reply only in English or Roman Urdu. If the customer uses Urdu/Hindi/Punjabi/Sindhi or another local language, write Roman Urdu, not Urdu/Arabic script.',
                `Recent conversation history for context only:\n${formatHistoryForPrompt(history) || '(none)'}`,
                `Business knowledge:\n${context || '(none)'}`,
              ].join('\n'),
            },
            { role: 'user' as const, content: userText },
          ],
          temperature: 0.3,
          max_tokens: 220,
        }),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const reply = data.choices?.[0]?.message?.content?.trim() || null;
      if (reply && containsUnsupportedReplyScript(reply)) return null;
      return reply;
    } catch {
      return null;
    }
  }
}

type AiProvider = {
  name: 'groq';
  apiKey: string;
  baseUrl: string;
  model: string;
};

type ConversationTurn = {
  role: 'customer' | 'assistant';
  text: string;
  createdAt: Date;
};

type TranscriptionProvider = {
  name: 'groq';
  apiKey: string;
  baseUrl: string;
  model: string;
  task: 'transcriptions' | 'translations';
  language?: string;
};

function getAiProvider(config: ConfigService): AiProvider | null {
  const groqKey = getEnvValue(config, 'GROQ_API_KEY');
  if (!groqKey) return null;
  return {
    name: 'groq',
    apiKey: groqKey,
    baseUrl:
      getEnvValue(config, 'GROQ_BASE_URL') || 'https://api.groq.com/openai/v1',
    model:
      getEnvValue(config, 'GROQ_MODEL') || 'llama-3.3-70b-versatile',
  };
}

function getTranscriptionProviders(config: ConfigService): TranscriptionProvider[] {
  const providers: TranscriptionProvider[] = [];
  const groqKey =
    getEnvValue(config, 'GROQ_TRANSCRIPTION_API_KEY') ||
    getEnvValue(config, 'GROQ_API_KEY');
  if (groqKey) {
    const provider: TranscriptionProvider = {
      name: 'groq',
      apiKey: groqKey,
      baseUrl:
        getEnvValue(config, 'GROQ_BASE_URL') || 'https://api.groq.com/openai/v1',
      model:
        getEnvValue(config, 'GROQ_TRANSCRIPTION_MODEL') || 'whisper-large-v3',
      task: getTranscriptionTask(config, 'GROQ_TRANSCRIPTION_TASK'),
    };
    const language = getEnvValue(config, 'GROQ_TRANSCRIPTION_LANGUAGE');
    if (language) provider.language = language;
    providers.push(provider);
  }

  return providers;
}

function getTranscriptionTask(config: ConfigService, key: string): 'transcriptions' | 'translations' {
  return getEnvValue(config, key) === 'translations' ? 'translations' : 'transcriptions';
}

function getEnvValue(config: ConfigService, key: string) {
  return readDotEnvValue(key) || config.get<string>(key)?.trim() || '';
}

function readDotEnvValue(key: string) {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return '';
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = readFileSync(envPath, 'utf8').match(
    new RegExp(`^\\s*${escaped}\\s*=\\s*(.*)\\s*$`, 'm'),
  );
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
}

function extensionFromMimeType(mimeType?: string) {
  if (!mimeType) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('webm')) return 'webm';
  return 'ogg';
}

function normalizeComparable(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsUnsupportedReplyScript(value: string) {
  return /[\u0600-\u06ff]/.test(value);
}

function formatHistoryForPrompt(history: ConversationTurn[]) {
  return history
    .slice(-8)
    .map((turn) => `${turn.role === 'customer' ? 'Customer' : 'Assistant'}: ${turn.text}`)
    .join('\n');
}

function isContextDependentMessage(text: string) {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(Boolean);

  if (words.length <= 4) return true;

  return /\b(us|iski|iska|iske|yeh|ye|wo|woh|same|again|aur|or|that|this|it|its|same one|above|previous|pichla|pichle)\b/i.test(
    lower,
  );
}

type AgentLike = {
  personaJson: unknown;
  rulesJson: unknown;
  replyLangPolicy: string;
} | null | undefined;

function buildAgentPrompt(agent: AgentLike) {
  const persona = isRecord(agent?.personaJson) ? agent.personaJson : {};
  const rules = isRecord(agent?.rulesJson) ? agent.rulesJson : {};
  const businessName = stringValue(persona['businessName']);
  const businessDescription = stringValue(persona['businessDescription']);
  const tone = stringValue(persona['tone']) || 'friendly, clear, and helpful';
  const intention = stringValue(persona['intention']);
  const customPrompt = stringValue(persona['systemPrompt']);
  const guardrails = stringValue(rules['guardrails']);
  const languagePolicy = agent?.replyLangPolicy ?? 'auto';

  const fallbackPrompt =
    'You are a concise WhatsApp business assistant. Use the provided business knowledge. If the answer is unknown, ask for details or say the team will follow up.';

  return [
    customPrompt || fallbackPrompt,
    businessName ? `Business name: ${businessName}` : '',
    businessDescription ? `Business description: ${businessDescription}` : '',
    intention ? `Agent intention: ${intention}` : '',
    `Tone: ${tone}`,
    `Reply language policy: ${languagePolicy}. If auto, match the customer language.`,
    guardrails ? `Important rules: ${guardrails}` : '',
    'Keep WhatsApp replies short, practical, and easy to understand.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildContextualUserText(userText: string, history: ConversationTurn[]) {
  if (history.length === 0) return userText;
  if (!isContextDependentMessage(userText)) return userText;

  const recentCustomerContext = history
    .filter((turn) => turn.role === 'customer')
    .slice(-2)
    .map((turn) => turn.text)
    .join('\n');

  if (!recentCustomerContext) return userText;

  return [
    'Recent customer context:',
    recentCustomerContext,
    '',
    'Latest customer message:',
    userText,
  ].join('\n');
}

function generateLocalReply(
  userText: string,
  context: string,
  agentPrompt: string,
  history: ConversationTurn[],
) {
  const enrichedUserText = buildContextualUserText(userText, history);
  const answer = answerFromKnowledge(enrichedUserText, context);
  if (answer) return humanizeReply(userText, answer, agentPrompt);

  return generateIntentFallback(userText, agentPrompt);
}

function humanizeReply(userText: string, answer: string, prompt: string) {
  const romanUrdu = prompt.toLowerCase().includes('roman_urdu') || isRomanUrdu(userText);
  const lower = answer.toLowerCase();

  if (!romanUrdu) {
    if (lower.includes('classes different batches')) {
      return 'Classes run in different batches. Please share the class or subject, and I will guide you with the exact timing.';
    }
    if (lower.startsWith('admissions start date')) {
      return 'The admission start date is not clear in the Knowledge Base yet. Please share the student class, and I will guide you with the next step.';
    }
    if (lower.startsWith('admission ke liye')) {
      return 'For admission, please share the student class, required subjects, and preferred timing.';
    }
    if (lower.startsWith('fee class')) {
      return 'Fees depend on the class and subjects. Please share the class or subject, and I will guide you with the exact fee.';
    }
    return answer;
  }

  if (lower.startsWith('timings:')) {
    const timings = answer.replace(/^timings:\s*/i, '');
    return `Ji, coaching timings ${timings} hain. Ap ko kaunsa slot suit karega?`;
  }

  if (lower.startsWith('fees:')) {
    const fees = answer.replace(/^fees:\s*/i, '');
    return `Ji, fee ${fees} hai. Ap class/subject bata dein to main exact option guide kar doon.`;
  }

  if (lower.startsWith('admissions start date:')) {
    const startDate = answer.replace(/^admissions start date:\s*/i, '');
    return startDate === 'open now'
      ? 'Ji, admissions open hain. Ap student ki class aur required subjects share kar dein.'
      : `Ji, admissions ${startDate} se start hain. Ap student ki class share kar dein?`;
  }

  return answer
    .replace(/^Admission ke liye please/i, 'Ji bilkul, admission ke liye')
    .replace(/^Online classes ke bare me confirm karne ke liye please/i, 'Ji, online class confirm karne ke liye');
}

function isRomanUrdu(text: string) {
  if (
    /\b(what|when|how|which|where|are|is|do|does|please)\b/i.test(text) &&
    !/\b(kia|kya|hai|hain|hoti|hota|chahiye|bata|batayein|kitni|kab|shuru|bachay|mujhe|ap|aap)\b/i.test(text)
  ) {
    return false;
  }
  return /\b(kia|kya|hai|hain|hoti|hota|chahiye|bata|batayein|kitni|kab|shuru|bachay|mujhe|ap|aap)\b/i.test(text);
}

function generateIntentFallback(userText: string, agentPrompt: string) {
  const intent = detectIntent(userText);
  const romanUrdu = agentPrompt.toLowerCase().includes('roman_urdu') || isRomanUrdu(userText);
  const businessName = extractPromptLine(agentPrompt, 'Business name');
  const namePrefix = businessName ? `${businessName} me ` : '';

  if (romanUrdu) {
    if (intent.label === 'timings') {
      return `${namePrefix}classes different batches me hoti hain. Ap class/subject bata dein, main exact timing guide kar deta hoon.`;
    }
    if (intent.label === 'admission') {
      return `${namePrefix}admissions ke liye ap student ki class aur required subjects share kar dein. Main apko next step bata deta hoon.`;
    }
    if (intent.label === 'fees') {
      return `${namePrefix}fee class aur subjects ke hisaab se hoti hai. Ap class/subject bata dein to exact fee guide kar deta hoon.`;
    }
    if (intent.label === 'courses') {
      return `${namePrefix}courses/classes ke liye ap apni class ya subject bata dein, main relevant option suggest kar deta hoon.`;
    }
    if (intent.label === 'online') {
      return `${namePrefix}online classes confirm karne ke liye ap class/subject bata dein. Main available option guide kar deta hoon.`;
    }
    return businessName
      ? `Ji, ${businessName} ke bare me apki help kar deta hoon. Ap apna sawal thora detail me bata dein?`
      : 'Ji, apna sawal thora detail me bata dein, main help kar deta hoon.';
  }

  if (intent.label === 'timings') {
    return `${businessName ? `${businessName} has` : 'We have'} different class batches. Please share the class or subject, and I will guide you with the exact timing.`;
  }
  if (intent.label === 'admission') {
    return `Admissions are open for the relevant classes. Please share the student's class and required subjects, and I will guide you with the next step.`;
  }
  if (intent.label === 'fees') {
    return `Fees depend on the class and subjects. Please share the class or subject, and I will guide you with the exact fee.`;
  }
  if (intent.label === 'courses') {
    return `Please share the class or subject you are interested in, and I will suggest the right option.`;
  }
  if (intent.label === 'online') {
    return `Please share the class or subject so I can confirm the available online class option.`;
  }

  return businessName
    ? `Thanks for contacting ${businessName}. Tell me what you need help with, and I will guide you.`
    : 'Tell me what you need help with, and I will guide you.';
}

function answerFromKnowledge(userText: string, context: string) {
  const intent = detectIntent(userText);
  const lines = context
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length < 500)
    .filter((item) => !isPromptBoilerplate(item));
  if (lines.length === 0) return null;

  if (intent.label === 'admission' && /(kab|start|shuru|when)/i.test(userText)) {
    const startDate = extractAdmissionStartDate(lines.join(' '));
    return startDate
      ? `Admissions start date: ${startDate}`
      : 'Admissions start date abhi knowledge base me clear nahi hai. Ap student ki class share kar dein, main next step guide kar deta hoon.';
  }

  const words = new Set(
    userText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );

  let best: string | null = null;
  let bestScore = 0;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const intentScore = intent.words.some((word) => lower.includes(word)) ? 5 : 0;
    const score = line
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .reduce((sum, word) => sum + (words.has(word) ? 1 : 0), intentScore);
    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  }

  if (best && bestScore >= 5) {
    return formatKnowledgeAnswer(intent.label, best);
  }

  if (intent.label === 'admission') {
    if (/(kab|start|shuru|when)/i.test(userText)) {
      return 'Admissions start date abhi knowledge base me clear nahi hai. Ap student ki class share kar dein, main next step guide kar deta hoon.';
    }
    return 'Admission ke liye student ki class, subjects aur preferred timing share kar dein.';
  }
  if (intent.label === 'online') {
    return 'Online classes ke bare me confirm karne ke liye class/subject share kar dein.';
  }
  if (intent.label === 'timings') {
    return 'Classes different batches me hoti hain. Ap class/subject bata dein, main exact timing guide kar deta hoon.';
  }
  if (intent.label === 'fees') {
    return 'Fee class aur subjects par depend karti hai. Class/subjects bata dein to exact fee guide kar deta hoon.';
  }

  return null;
}

function detectIntent(userText: string) {
  const lower = userText.toLowerCase();
  if (/(timing|time|schedule|hours|open|close|class time|timings|waqt)/.test(lower)) {
    return { label: 'timings', words: ['timing', 'time', 'schedule', 'hours', 'open', 'close', 'am', 'pm'] };
  }
  if (/(admission|admit|enroll|enrol|register|dakhla)/.test(lower)) {
    return { label: 'admission', words: ['admission', 'enroll', 'register', 'class', 'subject'] };
  }
  if (/(online|zoom|remote|whatsapp class|video class)/.test(lower)) {
    return { label: 'online', words: ['online', 'zoom', 'remote', 'video', 'class'] };
  }
  if (/(fee|fees|price|cost|charges|rate|kitna|paisa)/.test(lower)) {
    return { label: 'fees', words: ['fee', 'fees', 'price', 'cost', 'charges', 'rs', 'pkr'] };
  }
  if (/(course|subject|class|program|coaching|study)/.test(lower)) {
    return { label: 'courses', words: ['course', 'subject', 'class', 'program', 'coaching'] };
  }
  return { label: 'answer', words: [] };
}

function formatKnowledgeAnswer(label: string, answer: string) {
  const cleaned = answer.replace(/\s+/g, ' ').trim();
  if (label === 'timings') {
    const ranges = extractTimeRanges(cleaned);
    if (ranges.length > 0) return `Timings: ${ranges.join(', ')}`;
    return 'Classes different batches me hoti hain. Ap class/subject bata dein, main exact timing guide kar deta hoon.';
  }
  if (label === 'fees') {
    const fees = extractFeeAmounts(cleaned);
    if (fees.length > 0) return `Fees: ${fees.join(', ')}`;
    return 'Fee class aur subjects par depend karti hai. Class/subjects bata dein to exact fee guide kar deta hoon.';
  }
  if (label === 'admission') {
    return 'Admission ke liye student ki class, required subjects aur preferred timing share kar dein.';
  }
  if (label === 'online') {
    if (/\bonline\b|\bzoom\b|\bremote\b/i.test(cleaned)) {
      return 'Online classes available hain. Class/subject share kar dein taake exact batch bata sakoon.';
    }
    return 'Online classes ke bare me confirm karne ke liye class/subject share kar dein.';
  }
  const short = cleaned.length > 280 ? `${cleaned.slice(0, 277)}...` : cleaned;
  return isLikelyScriptText(short)
    ? 'Ap apni class/subject thora detail me share kar dein, main guide kar deta hoon.'
    : short;
}

function extractTimeRanges(text: string) {
  const matches = Array.from(
    text.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\s*(?:[-–—to]+\s*)\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\b/g),
  ).map((match) => match[0].replace(/\s+/g, ' ').replace(/\s*[-–—to]+\s*/i, ' - '));

  return Array.from(new Set(matches)).slice(0, 5);
}

function extractFeeAmounts(text: string) {
  if (/xxxx|xxx/i.test(text)) return [];
  const matches = Array.from(
    text.matchAll(/(?:rs\.?|pkr)?\s*\d{2,7}(?:,\d{3})?\s*(?:rs\.?|pkr)?/gi),
  ).map((match) => match[0].replace(/\s+/g, ' ').trim());

  return Array.from(new Set(matches)).slice(0, 5);
}

function extractAdmissionStartDate(text: string) {
  const explicitDate = text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i);
  if (explicitDate) return explicitDate[0].replace(/\s+/g, ' ');
  if (/\badmissions?\s+(?:are\s+)?open\b/i.test(text)) return 'open now';
  return null;
}

function isLikelyScriptText(text: string) {
  return /\b(user|bot|demo|flow|inquiry|ask class|initial greeting)\s*:/i.test(text) ||
    /\bUser:\b|\bBot:\b/.test(text);
}

function isPromptBoilerplate(line: string) {
  const lower = line.toLowerCase();
  return [
    'system role',
    'system prompt',
    'chatbot boundaries',
    'primary goals',
    'you are an',
    'you must always',
    'dataset',
    'boundaries',
  ].some((marker) => lower.includes(marker));
}

function formatWaId(waId: string) {
  return waId.replace(/@s\.whatsapp\.net$/i, '').replace(/@c\.us$/i, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractPromptLine(prompt: string, label: string) {
  const line = prompt
    .split('\n')
    .find((item) => item.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  return line?.split(':').slice(1).join(':').trim() ?? '';
}

import { z } from 'zod';

const PersonaSchema = z.object({
  name: z.string().min(1).optional(),
  tone: z.enum(['formal', 'friendly', 'neutral']).optional(),
  languages: z.array(z.string()).optional(),
  businessHoursBehavior: z.enum(['auto', 'pause', 'handoff']).optional(),
  fallbackMessage: z.string().optional(),
});

const RulesSchema = z.object({
  neverSay: z.array(z.string()).optional(),
  alwaysHandoffTriggers: z.array(z.string()).optional(),
  collectFields: z.array(z.string()).optional(),
  autoReplyOutsideWindow: z.boolean().optional(),
  confidenceHandoffThreshold: z.number().min(0).max(1).optional(),
});

export const UpsertAgentConfigSchema = z.object({
  persona: PersonaSchema.optional(),
  rules: RulesSchema.optional(),
  replyLangPolicy: z.enum(['auto', 'roman_urdu', 'english', 'urdu']).optional(),
});

export type UpsertAgentConfigDto = z.infer<typeof UpsertAgentConfigSchema>;

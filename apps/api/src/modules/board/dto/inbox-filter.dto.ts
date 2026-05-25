import { z } from 'zod';

export const InboxFilterSchema = z.object({
  channelId: z.string().uuid().optional(),
  state: z.enum(['open', 'resolved', 'archived']).optional(),
  aiMode: z.enum(['auto', 'paused', 'off']).optional(),
  pipelineStage: z.string().optional(),
  assignedMemberId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type InboxFilterDto = z.infer<typeof InboxFilterSchema>;

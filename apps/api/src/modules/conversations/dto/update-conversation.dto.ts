import { z } from 'zod';

export const UpdateConversationSchema = z.object({
  state: z.enum(['open', 'resolved', 'archived']).optional(),
  pipelineStage: z.string().min(1).optional(),
  aiMode: z.enum(['auto', 'paused', 'off']).optional(),
  assignedMemberId: z.string().uuid().nullable().optional(),
});

export type UpdateConversationDto = z.infer<typeof UpdateConversationSchema>;

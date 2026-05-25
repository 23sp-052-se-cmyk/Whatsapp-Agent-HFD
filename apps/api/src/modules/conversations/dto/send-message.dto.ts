import { z } from 'zod';

export const SendMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1) }),
  z.object({
    kind: z.literal('media'),
    mediaUrl: z.string().url(),
    caption: z.string().optional(),
    mimeType: z.string().optional(),
  }),
]);

export type SendMessageDto = z.infer<typeof SendMessageSchema>;

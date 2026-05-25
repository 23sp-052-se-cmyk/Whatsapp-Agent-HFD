import { z } from 'zod';

export const CreateChannelSchema = z.object({
  phone: z.string().min(7).max(20),
  provider: z.enum(['baileys', 'cloud_api']).default('baileys'),
});

export type CreateChannelDto = z.infer<typeof CreateChannelSchema>;

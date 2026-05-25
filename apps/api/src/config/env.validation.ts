import { z } from 'zod';

const envVariablesSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(5000),
  JWT_SECRET: z.string().min(10),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  CHANNEL_QUEUE_NAME: z.string().min(1).default('outbound-messages'),
  CORS_ORIGIN: z.string().min(1).default('*'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type ApiEnv = z.infer<typeof envVariablesSchema>;

export function validate(config: Record<string, unknown>): ApiEnv {
  const parsed = envVariablesSchema.safeParse(config);

  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }

  return parsed.data;
}

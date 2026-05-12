import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  API_BEARER_KEY: z.string().optional(),
  API_USER_TELEGRAM_ID: z.coerce.number().optional(),
  OPENAI_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten());
    throw new Error("Invalid environment");
  }
  return parsed.data;
}

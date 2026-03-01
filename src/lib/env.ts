import { z } from "zod";

const envSchema = z.object({
  WHISPER_API_KEY: z.string().optional(),
  WHISPER_PROJECT: z.string().default("memory-demo"),
  WHISPER_BASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment variables: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;

export function isWhisperConfigured() {
  return Boolean(env.WHISPER_API_KEY);
}

export function isOpenAiConfigured() {
  return Boolean(env.OPENAI_API_KEY);
}

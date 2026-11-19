import { z } from "zod";
import { lazy } from "@engine/utils/lazy";

// Env is parsed lazily, per section, so importing engine modules never
// throws. The worker calls getEnv() at boot to fail fast on everything;
// the Next.js app only touches the sections its imports actually use.

const DbEnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
});

const RedisEnvSchema = z.object({
  REDIS_URL: z.string().min(1),
});

/** Comma-separated model names, in the order to try them. Blank means none. */
const ModelListSchema = z
  .string()
  .default("")
  .transform((s) => s.split(",").map((m) => m.trim()).filter(Boolean));

const LlmEnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  MODEL_SEARCH: z.string().min(1),
  MODEL_EXTRACT: z.string().min(1),
  MODEL_VERIFY: z.string().min(1),
  MODEL_SUGGEST: z.string().min(1),
  MODEL_JUDGE: z.string().min(1),
  // Tried in order when the role's model answers 503 (overloaded).
  // The judge has none: a different grader would skew eval results.
  MODEL_SEARCH_FALLBACKS: ModelListSchema,
  MODEL_EXTRACT_FALLBACKS: ModelListSchema,
  MODEL_VERIFY_FALLBACKS: ModelListSchema,
  MODEL_SUGGEST_FALLBACKS: ModelListSchema,
});

const WorkerEnvSchema = z.object({
  ENRICH_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  RATE_MAX: z.coerce.number().int().min(1).default(5),
});

const LogLevelSchema = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  .default("info");

const EnvSchema = DbEnvSchema.extend(RedisEnvSchema.shape)
  .extend(LlmEnvSchema.shape)
  .extend(WorkerEnvSchema.shape)
  .extend({ LOG_LEVEL: LogLevelSchema });

export type EngineEnv = z.infer<typeof EnvSchema>;
export type DbEnv = z.infer<typeof DbEnvSchema>;
export type RedisEnv = z.infer<typeof RedisEnvSchema>;
export type LlmEnv = z.infer<typeof LlmEnvSchema>;
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;

function parse<T extends z.ZodType>(schema: T, label: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Invalid ${label} environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export const getEnv = lazy(() => parse(EnvSchema, "engine"));
export const getDbEnv = lazy(() => parse(DbEnvSchema, "database"));
export const getRedisEnv = lazy(() => parse(RedisEnvSchema, "Redis"));
export const getLlmEnv = lazy(() => parse(LlmEnvSchema, "LLM"));
export const getWorkerEnv = lazy(() => parse(WorkerEnvSchema, "worker"));
// Not memoised: the logger is created at import time, before standalone
// entry points call loadEnvFiles(), so they re-read the level afterwards.
export function getLogLevel(): LogLevel {
  const result = LogLevelSchema.safeParse(process.env.LOG_LEVEL || undefined);
  if (!result.success) {
    throw new Error(`Invalid LOG_LEVEL:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

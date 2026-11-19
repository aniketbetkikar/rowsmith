import "server-only";
import { z } from "zod";
import { MAX_MINUTES_PER_FIELD } from "./time-saved";

const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  APP_URL: z.url(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

function load(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}

// Parsed on its own, so pages that use it (the landing page) can render at
// build time without the app's secrets.
const TimeSavedEnvSchema = z.object({
  DEFAULT_MINUTES_PER_FIELD: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().positive().max(MAX_MINUTES_PER_FIELD).default(0.5),
  ),
});

let minutesCached: number | undefined;

/** Minutes a person needs per value using ChatGPT or Claude: the time-saved assumption. */
export function defaultMinutesPerField(): number {
  if (minutesCached !== undefined) return minutesCached;
  const parsed = TimeSavedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:
${z.prettifyError(parsed.error)}`);
  }
  minutesCached = parsed.data.DEFAULT_MINUTES_PER_FIELD;
  return minutesCached;
}

// Parsed on its own, so the root layout's metadata builds without secrets.
const SiteUrlEnvSchema = z.object({
  APP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
});

/** The public site URL for absolute metadata links (Open Graph), if set. */
export function siteUrl(): URL | undefined {
  const parsed = SiteUrlEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:
${z.prettifyError(parsed.error)}`);
  }
  return parsed.data.APP_URL ? new URL(parsed.data.APP_URL) : undefined;
}

/**
 * Validates the environment. Called from src/instrumentation.ts so the
 * server fails fast at boot, while `next build` (which imports route
 * modules) does not need runtime secrets.
 */
export function assertEnv(): void {
  load();
  defaultMinutesPerField();
}

/** Typed, validated env. Each read validates on first use. */
export const env: Env = {
  get MONGODB_URI() {
    return load().MONGODB_URI;
  },
  get REDIS_URL() {
    return load().REDIS_URL;
  },
  get GEMINI_API_KEY() {
    return load().GEMINI_API_KEY;
  },
  get APP_URL() {
    return load().APP_URL;
  },
};

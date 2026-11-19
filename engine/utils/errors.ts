import { z } from "zod";

/** Explicitly retryable failure: BullMQ should back off and retry the job. */
export class TransientError extends Error {
  override readonly name = "TransientError";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** Misconfiguration (missing price entry, bad env). Never retried. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429]);

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const TRANSIENT_NAMES = new Set([
  "TransientError",
  "TimeoutError", // AbortSignal.timeout() and SDK request timeouts
]);

// Read the fields we care about from an unknown thrown value. Works for
// Google Gen AI errors (status), LangChain-wrapped errors and Node network
// errors (fetch failures carry the network code on `cause`).
const ErrorShapeSchema = z.object({
  name: z.string().optional(),
  status: z.number().optional(),
  code: z.union([z.string(), z.number()]).nullish(),
  cause: z.unknown().optional(),
});

/**
 * True for errors worth retrying with backoff: rate limits, 5xx, timeouts
 * and network failures. Quota exhaustion (429 insufficient_quota) is not
 * transient: retrying cannot succeed.
 */
export function isTransient(err: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  const shape = ErrorShapeSchema.safeParse(err);
  if (!shape.success) return false;
  const { name, status, code, cause } = shape.data;

  if (code === "insufficient_quota") return false;
  if (name && TRANSIENT_NAMES.has(name)) return true;
  if (status !== undefined) {
    return RETRYABLE_STATUS.has(status) || status >= 500;
  }
  if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
  return cause !== undefined && isTransient(cause, depth + 1);
}

const OVERLOADED_TEXT = /\b503\b|UNAVAILABLE|overloaded|high demand/i;

/**
 * True for a 503 / UNAVAILABLE ("model overloaded, high demand"): the model
 * is saturated, so a sibling model is worth trying straight away. Works for
 * Google Gen AI errors (status) and LangChain-wrapped ones (message, cause).
 */
export function isOverloaded(err: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  const shape = ErrorShapeSchema.safeParse(err);
  if (!shape.success) return false;
  if (shape.data.status === 503) return true;
  if (shape.data.status === undefined && err instanceof Error && OVERLOADED_TEXT.test(err.message)) {
    return true;
  }
  return shape.data.cause !== undefined && isOverloaded(shape.data.cause, depth + 1);
}

// Google API errors carry the response body as their message:
// {"error":{"code":429,"message":"…","status":"RESOURCE_EXHAUSTED",…}}
const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string(),
    status: z.string().optional(),
  }),
});

const MAX_MESSAGE = 300;

function readableApiError(message: string): string | null {
  const start = message.indexOf("{");
  if (start === -1) return null;
  try {
    const body = ApiErrorBodySchema.safeParse(JSON.parse(message.slice(start)));
    if (!body.success) return null;
    const { code, status, message: text } = body.data.error;
    return [code, status].filter(Boolean).join(" ") + (code || status ? ": " : "") + text.trim();
  } catch {
    return null;
  }
}

/**
 * Node's fetch only says "fetch failed"; the real reason (ENOTFOUND,
 * ECONNRESET, a TLS error…) is on `cause`, possibly a few levels down.
 */
function rootCause(err: unknown, depth = 0): string | null {
  if (depth > 5 || !(err instanceof Error) || err.cause === undefined) return null;
  const deeper = rootCause(err.cause, depth + 1);
  if (deeper) return deeper;
  const shape = ErrorShapeSchema.safeParse(err.cause);
  const code = shape.success ? shape.data.code : undefined;
  const text = err.cause instanceof Error ? err.cause.message : null;
  if (code && text && !text.includes(String(code))) return `${code}: ${text}`;
  return text ?? (code ? String(code) : null);
}

/** Short, readable message for any thrown value (logs, row/job `error`). */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
  const cause = rootCause(err);
  const base = readableApiError(raw) ?? raw;
  const message = cause && !base.includes(cause) ? `${base} (${cause})` : base;
  return message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message;
}

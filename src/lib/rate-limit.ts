import "server-only";
import { fail, type ApiError } from "./http";
import { getRedis } from "./redis";
import type { NextResponse } from "next/server";

export type LimitResult = { ok: boolean; retryAfter: number };

/**
 * Fixed-window limiter: at most `max` hits per `windowSec` for `key`.
 * `retryAfter` is the number of seconds until the current window resets.
 */
export async function limit(key: string, max: number, windowSec: number): Promise<LimitResult> {
  const nowSec = Date.now() / 1000;
  const window = Math.floor(nowSec / windowSec);
  const redisKey = `rowsmith:rl:${key}:${window}`;

  const results = await getRedis().multi().incr(redisKey).expire(redisKey, windowSec).exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  const retryAfter = Math.max(1, Math.ceil((window + 1) * windowSec - nowSec));
  return { ok: count <= max, retryAfter };
}

/** Client IP from the proxy headers (first x-forwarded-for hop). */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Applies a per-route, per-IP limit. Returns a 429 response, or null to proceed. */
export async function rateLimit(
  req: Request,
  route: string,
  max: number,
  windowSec = 60,
): Promise<NextResponse<ApiError> | null> {
  const { ok, retryAfter } = await limit(`${route}:${clientIp(req)}`, max, windowSec);
  if (ok) return null;
  return fail("rate_limited", `Too many requests. Try again in ${retryAfter}s.`, 429, {
    retryAfter,
    headers: { "Retry-After": String(retryAfter) },
  });
}

/** Per-route limits (requests per minute per IP). */
export const LIMITS = {
  suggest: 10,
  createJob: 5,
  retryJob: 5,
  // Status/rows polling runs every 2 s per open tab.
  read: 120,
} as const;

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Redis MULTI INCR/EXPIRE the limiter uses.
const store = vi.hoisted(() => new Map<string, number>());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis", () => ({
  getRedis: () => {
    const ops: (() => [null, number])[] = [];
    const tx = {
      incr(key: string) {
        ops.push(() => {
          const n = (store.get(key) ?? 0) + 1;
          store.set(key, n);
          return [null, n];
        });
        return tx;
      },
      expire() {
        ops.push(() => [null, 1]);
        return tx;
      },
      exec: async () => ops.map((op) => op()),
    };
    return { multi: () => tx };
  },
}));

const { clientIp, limit, rateLimit } = await import("./rate-limit");

function req(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/x", { headers });
}

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T10:00:15Z"));
});
afterEach(() => vi.useRealTimers());

describe("limit", () => {
  it("allows up to max hits per window, then blocks", async () => {
    for (let i = 0; i < 3; i++) expect((await limit("k", 3, 60)).ok).toBe(true);
    const blocked = await limit("k", 3, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(45); // 15 s into a 60 s window
  });

  it("starts a fresh count in the next window", async () => {
    for (let i = 0; i < 4; i++) await limit("k", 3, 60);
    vi.setSystemTime(new Date("2026-10-26T10:01:01Z"));
    expect((await limit("k", 3, 60)).ok).toBe(true);
  });

  it("counts keys independently", async () => {
    await limit("a", 1, 60);
    expect((await limit("b", 1, 60)).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for hop, then x-real-ip", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientIp(req({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

describe("rateLimit", () => {
  it("returns null while allowed and a 429 with retryAfter once exceeded", async () => {
    const r = req({ "x-forwarded-for": "9.9.9.9" });
    expect(await rateLimit(r, "suggest", 1)).toBeNull();

    const res = await rateLimit(r, "suggest", 1);
    expect(res?.status).toBe(429);
    expect(res?.headers.get("retry-after")).toBe("45");
    expect(await res?.json()).toEqual({
      error: { code: "rate_limited", message: "Too many requests. Try again in 45s.", retryAfter: 45 },
    });
  });

  it("limits per route and per IP", async () => {
    const a = req({ "x-forwarded-for": "1.1.1.1" });
    const b = req({ "x-forwarded-for": "2.2.2.2" });
    await rateLimit(a, "suggest", 1);
    expect(await rateLimit(b, "suggest", 1)).toBeNull();
    expect(await rateLimit(a, "jobs:create", 1)).toBeNull();
  });
});

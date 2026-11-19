import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { ConfigError, errorMessage, isOverloaded, isTransient, TransientError } from "./errors";

function apiError(status: number) {
  return new ApiError({ message: `status ${status}`, status });
}

describe("isTransient", () => {
  it("retries rate limits, overload and server errors", () => {
    expect(isTransient(apiError(429))).toBe(true);
    expect(isTransient(apiError(503))).toBe(true);
    expect(isTransient(apiError(500))).toBe(true);
    expect(isTransient({ status: 408 })).toBe(true);
  });

  it("does not retry client errors", () => {
    expect(isTransient(apiError(400))).toBe(false);
    expect(isTransient(apiError(401))).toBe(false);
    expect(isTransient(apiError(404))).toBe(false);
  });

  it("retries network failures, including ones wrapped as a cause", () => {
    expect(isTransient(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransient(new TypeError("fetch failed", { cause: { code: "UND_ERR_SOCKET" } }))).toBe(true);
    expect(isTransient(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(true);
    expect(isTransient(new TransientError("x"))).toBe(true);
  });

  it("does not retry everything else", () => {
    expect(isTransient(new Error("nope"))).toBe(false);
    expect(isTransient(new ConfigError("no price"))).toBe(false);
    expect(isTransient("string")).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});

describe("errorMessage", () => {
  it("handles errors, strings and unknowns", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("Unknown error");
  });

  it("turns Google API error bodies into a readable line", () => {
    const body = JSON.stringify({
      error: { code: 429, message: "You exceeded your current quota. ", status: "RESOURCE_EXHAUSTED", details: [] },
    });
    expect(errorMessage(new ApiError({ message: body, status: 429 }))).toBe(
      "429 RESOURCE_EXHAUSTED: You exceeded your current quota.",
    );
    expect(errorMessage(new Error(`[GoogleGenerativeAI Error]: ${body}`))).toBe(
      "429 RESOURCE_EXHAUSTED: You exceeded your current quota.",
    );
  });

  it("adds the network cause to fetch failures", () => {
    const dns = Object.assign(new Error("getaddrinfo ENOTFOUND generativelanguage.googleapis.com"), { code: "ENOTFOUND" });
    expect(errorMessage(new TypeError("fetch failed", { cause: dns }))).toBe(
      "fetch failed (getaddrinfo ENOTFOUND generativelanguage.googleapis.com)",
    );
    const reset = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
    expect(errorMessage(new TypeError("fetch failed", { cause: reset }))).toBe(
      "fetch failed (UND_ERR_SOCKET: other side closed)",
    );
  });

  it("truncates very long messages", () => {
    expect(errorMessage(new Error("x".repeat(1000)))).toHaveLength(300);
  });
});

describe("isOverloaded", () => {
  it("is true for a 503, a LangChain-wrapped 503 and an overloaded cause", () => {
    expect(isOverloaded(Object.assign(new Error("x"), { status: 503 }))).toBe(true);
    expect(isOverloaded(new Error("[503 Service Unavailable] The model is overloaded."))).toBe(true);
    expect(isOverloaded(new Error("wrapped", { cause: Object.assign(new Error("x"), { status: 503 }) }))).toBe(true);
  });

  it("is false for other errors", () => {
    expect(isOverloaded(Object.assign(new Error("x"), { status: 429 }))).toBe(false);
    expect(isOverloaded(Object.assign(new Error("x"), { status: 500 }))).toBe(false);
    expect(isOverloaded(new Error("bad request"))).toBe(false);
  });
});

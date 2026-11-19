import { describe, expect, it } from "vitest";
import { ConfigError } from "@engine/utils/errors";
import { searchCost, tokenCost } from "./cost";

const thinking = { default: "low", levels: ["low"] } as const;
const catalog = {
  "model-a": { price: { input: 2, cachedInput: 0.5, output: 8 }, thinking },
  "model-b": {
    price: { input: 1, cachedInput: 0.1, output: 4 },
    changes: [{ from: "2027-01-01", price: { input: 2, cachedInput: 0.2, output: 8 } }],
    thinking,
  },
};
const today = new Date("2026-10-29T12:00:00Z");

describe("tokenCost", () => {
  it("prices uncached input, cached input and output per 1M tokens", () => {
    const cost = tokenCost(
      "model-a",
      { inputTokens: 1_000_000, cachedTokens: 400_000, outputTokens: 500_000 },
      catalog,
      today,
    );
    // 600k × $2 + 400k × $0.5 + 500k × $8 (per 1M)
    expect(cost).toBeCloseTo(1.2 + 0.2 + 4, 10);
  });

  it("returns 0 for no tokens", () => {
    expect(
      tokenCost("model-a", { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, catalog, today),
    ).toBe(0);
  });

  it("never counts more cached tokens than input tokens", () => {
    const cost = tokenCost(
      "model-a",
      { inputTokens: 100, cachedTokens: 500, outputTokens: 0 },
      catalog,
      today,
    );
    expect(cost).toBeCloseTo((100 * 0.5) / 1_000_000, 12);
  });

  it("applies an announced price change from its date (UTC)", () => {
    const usage = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 };
    expect(tokenCost("model-b", usage, catalog, new Date("2026-12-31T23:59:59Z"))).toBeCloseTo(1, 10);
    expect(tokenCost("model-b", usage, catalog, new Date("2027-01-01T00:00:00Z"))).toBeCloseTo(2, 10);
  });

  it("throws a ConfigError for an unknown model", () => {
    expect(() =>
      tokenCost("nope", { inputTokens: 1, cachedTokens: 0, outputTokens: 1 }, catalog, today),
    ).toThrow(ConfigError);
  });
});

describe("searchCost", () => {
  it("multiplies calls by the per-call price", () => {
    expect(searchCost(3, 0.01)).toBeCloseTo(0.03, 12);
    expect(searchCost(0, 0.01)).toBe(0);
  });
});

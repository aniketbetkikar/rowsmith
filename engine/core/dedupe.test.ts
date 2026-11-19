import { describe, expect, it } from "vitest";
import { normalizeKey } from "./dedupe";

describe("normalizeKey", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeKey("  Zerodha   Broking  ")).toBe("zerodha broking");
  });

  it("strips punctuation", () => {
    expect(normalizeKey("Notion, Inc.")).toBe("notion");
    expect(normalizeKey("Ben & Jerry's")).toBe("ben jerry s");
  });

  it("drops accents via Unicode normalisation", () => {
    expect(normalizeKey("Café Coffee Day")).toBe(normalizeKey("Cafe Coffee Day"));
  });

  it("removes trailing company suffixes, including stacked ones", () => {
    expect(normalizeKey("Razorpay Software Private Limited")).toBe("razorpay software");
    expect(normalizeKey("Acme Pvt. Ltd.")).toBe("acme");
    expect(normalizeKey("Acme LLC")).toBe("acme");
    expect(normalizeKey("Acme Co.")).toBe("acme");
  });

  it("matches common variants of the same company", () => {
    const variants = ["Canva", "canva", "Canva Inc", "CANVA, INC.", " Canva  "];
    const keys = new Set(variants.map(normalizeKey));
    expect(keys).toEqual(new Set(["canva"]));
  });

  it("only strips whole-word suffixes at the end", () => {
    expect(normalizeKey("Coinbase")).toBe("coinbase");
    expect(normalizeKey("Inc Magazine")).toBe("inc magazine");
  });

  it("keeps a key that is only a suffix", () => {
    expect(normalizeKey("Co")).toBe("co");
  });
});

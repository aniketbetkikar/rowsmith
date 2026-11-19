import { describe, expect, it } from "vitest";
import type { FieldDef } from "@engine/contracts/job-config";
import { listOverlap, normalizeUrl, scoreCell, summarize } from "./score";

const f = {
  year: { name: "founded", type: "year", description: "Year" },
  num: { name: "employees", type: "number", description: "Headcount" },
  bool: { name: "is_public", type: "boolean", description: "Listed" },
  enum: { name: "industry", type: "enum", description: "Industry", options: ["SaaS", "Fintech"] },
  url: { name: "website", type: "url", description: "Site" },
  text: { name: "ceo", type: "text", description: "CEO" },
  list: { name: "founders", type: "list", description: "Founders" },
} satisfies Record<string, FieldDef>;

describe("scoreCell", () => {
  it("exact-matches year, number, boolean and enum (with light coercion)", () => {
    expect(scoreCell(f.year, 2013, 2013).score).toBe(1);
    expect(scoreCell(f.year, 2013, "2013").score).toBe(1);
    expect(scoreCell(f.year, 2013, 2012).score).toBe(0);
    expect(scoreCell(f.num, 1.5, 1.5).score).toBe(1);
    expect(scoreCell(f.bool, false, false).score).toBe(1);
    expect(scoreCell(f.bool, true, "TRUE").score).toBe(1);
    expect(scoreCell(f.bool, true, false).score).toBe(0);
    expect(scoreCell(f.enum, "SaaS", "saas").score).toBe(1);
    expect(scoreCell(f.enum, "SaaS", "Fintech").score).toBe(0);
  });

  it("normalises urls and text", () => {
    expect(scoreCell(f.url, "https://www.notion.com", "notion.com/").score).toBe(1);
    expect(scoreCell(f.url, "https://notion.com", "https://notion.so").score).toBe(0);
    expect(scoreCell(f.text, "Nithin Kamath", "  nithin  kamath. ").score).toBe(1);
    expect(scoreCell(f.text, "Nithin Kamath", "Nikhil Kamath").score).toBe(0);
  });

  it("gives partial credit for list overlap", () => {
    expect(scoreCell(f.list, ["Ivan Zhao", "Simon Last"], ["ivan zhao", "Simon Last"]).score).toBe(1);
    expect(scoreCell(f.list, ["A", "B"], ["A", "C"]).score).toBeCloseTo(1 / 3);
    const disjoint = scoreCell(f.list, ["A"], ["B"]);
    expect(disjoint).toEqual({ score: 0, predictedNull: false, wrong: true });
  });

  it("treats a correct null as right, a missing value as a miss, an invented value as wrong", () => {
    expect(scoreCell(f.year, null, null)).toEqual({ score: 1, predictedNull: true, wrong: false });
    expect(scoreCell(f.year, 2013, null)).toEqual({ score: 0, predictedNull: true, wrong: false });
    expect(scoreCell(f.year, null, 2013)).toEqual({ score: 0, predictedNull: false, wrong: true });
    expect(scoreCell(f.year, 2013, 1999)).toEqual({ score: 0, predictedNull: false, wrong: true });
  });

  it("counts empty strings and empty lists as null predictions", () => {
    expect(scoreCell(f.text, "x", "  ").predictedNull).toBe(true);
    expect(scoreCell(f.list, ["A"], []).predictedNull).toBe(true);
  });
});

describe("helpers", () => {
  it("normalizeUrl ignores scheme, www, query, hash and trailing slash", () => {
    expect(normalizeUrl("HTTPS://www.Example.com/about/?utm=1#x")).toBe("example.com/about");
    expect(normalizeUrl("example.com")).toBe("example.com");
  });
  it("listOverlap is Jaccard on normalised items", () => {
    expect(listOverlap([], [])).toBe(1);
    expect(listOverlap(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(0.5);
  });
});

describe("summarize", () => {
  const fields: FieldDef[] = [f.year, f.text];
  const gold = { founded: 2013, ceo: "Ivan Zhao" };

  it("aggregates per field and overall, treating failed rows as all-null", () => {
    const report = summarize(fields, [
      { key: "A", gold, predicted: { founded: 2013, ceo: "Ivan Zhao" }, status: "done", costUsd: 0.02, attempts: 1 },
      { key: "B", gold, predicted: { founded: 2012, ceo: null }, status: "done", costUsd: 0.04, attempts: 3 },
      { key: "C", gold, predicted: null, status: "failed", costUsd: 0, attempts: 0 },
    ]);

    expect(report.rows).toBe(3);
    expect(report.failedRows).toBe(1);
    expect(report.perField).toEqual([
      { name: "founded", accuracy: 1 / 3, nullRate: 1 / 3, wrongRate: 1 / 3, falseRate: 1 / 2 },
      { name: "ceo", accuracy: 1 / 3, nullRate: 2 / 3, wrongRate: 0, falseRate: 0 },
    ]);
    expect(report.overall).toEqual({
      accuracy: 2 / 6,
      nullRate: 3 / 6,
      wrongRate: 1 / 6,
      falseRate: 1 / 3,
    });
    expect(report.avgCostUsd).toBeCloseTo(0.02);
    expect(report.avgAttempts).toBeCloseTo(4 / 3);
  });
});

import { describe, expect, it } from "vitest";
import type { Evidence } from "@engine/contracts/row-result";
import { commentsCell } from "./comments";

const fields = ["pages", "series", "retail_price", "summary"];
const quoted = { quotes: [{ text: "It has 320 pages", sources: [1] }] };
const row = (sources = 3, status: "done" | "failed" = "done") => ({
  key: "Atomic Habits",
  status,
  sources: Array.from({ length: sources }, (_, i) => ({ url: `https://s${i}.com`, title: "" })),
});

describe("commentsCell", () => {
  it("is empty when nothing is blank", () => {
    expect(commentsCell(fields, { pages: quoted }, row())).toBe("");
  });

  it("explains blanks grouped by reason", () => {
    const evidence: Evidence = {
      pages: quoted,
      series: { quotes: [], blank: "not_found" },
      summary: { quotes: [], blank: "not_found" },
      retail_price: { quotes: [], blank: "rejected" },
    };
    expect(commentsCell(fields, evidence, row())).toBe(
      "None of the 3 sources mention series and summary for Atomic Habits: they may not apply, or they aren't published online. " +
        "Sources were found for retail_price, but on checking they didn't state it for Atomic Habits exactly (for example another edition, scope or date), so it was left out.",
    );
  });

  it("explains an unsupported value", () => {
    const evidence: Evidence = { pages: quoted, series: { quotes: [], blank: "unsupported" } };
    expect(commentsCell(fields, evidence, row())).toBe(
      "A value for series was found, but no cited source states it, so it was left out rather than guessed.",
    );
  });

  it("flags filled values that rest only on the search's summary", () => {
    const summary = { quotes: [{ text: "It is part of a series", sources: [2], origin: "search" as const }] };
    const evidence: Evidence = {
      pages: { quotes: [{ text: "Pages: 320", sources: [1], origin: "page" }] },
      series: summary,
      summary,
      retail_price: { quotes: [], blank: "not_found" },
    };
    expect(commentsCell(fields, evidence, row())).toBe(
      "None of the 3 sources mention retail_price for Atomic Habits: it may not apply, or it isn't published online. " +
        "series and summary come from the search's summary of the sources, not from text we could read on the page, so check them before relying on them.",
    );
  });

  it("explains a row with every field blank once", () => {
    const evidence: Evidence = Object.fromEntries(fields.map((f) => [f, { quotes: [], blank: "not_found" as const }]));
    expect(commentsCell(fields, evidence, row(1))).toMatch(/^No source stated any of the fields for Atomic Habits\./);
  });

  it("points failed rows to _status", () => {
    expect(commentsCell(fields, {}, row(0, "failed"))).toMatch(/see _status/);
  });
});

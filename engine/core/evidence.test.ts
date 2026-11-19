import { describe, expect, it } from "vitest";
import type { FieldDef } from "@engine/contracts/job-config";
import { allBlank, checkEvidence, findClaim, normalizeQuote, valueInQuote } from "./evidence";

const claims = [
  { text: "**Zerodha** was founded in 2010 by Nithin Kamath and Nikhil Kamath.", sources: [1, 3] },
  { text: "The company’s headcount is about 1,200 people.", sources: [2] },
];
const sources = [
  { url: "https://zerodha.com/about", title: "zerodha.com" },
  { url: "https://example.com/a", title: "example.com" },
  { url: "https://en.wikipedia.org/wiki/Zerodha", title: "wikipedia.org" },
];

const f = {
  founded: { name: "founded", type: "year", description: "Year founded" },
  staff: { name: "staff", type: "number", description: "Employees" },
  website: { name: "website", type: "url", description: "Official site" },
  founders: { name: "founders", type: "list", description: "Co-founders" },
  ceo: { name: "ceo", type: "text", description: "CEO" },
} satisfies Record<string, FieldDef>;

describe("normalizeQuote", () => {
  it("ignores case, spacing, markdown, curly quotes, dashes and [S#] tags", () => {
    expect(normalizeQuote("  **The company’s**   head–count [S1, S2] ")).toBe("the company's head-count");
  });
});

describe("findClaim", () => {
  it("ignores digit grouping, as a model often drops it", () => {
    const rows = [{ text: "Number of employees: 383,853 (2025)", sources: [1] }];
    expect(findClaim("Number of employees: 383853 (2025)", rows)).toBe(rows[0]);
    expect(findClaim("Number of employees: 383 853 (2025)", rows)).toBe(rows[0]);
    expect(findClaim("Number of employees: 38,853 (2025)", rows)).toBeNull();
  });

  it("finds the claim a quote was copied from", () => {
    expect(findClaim("Zerodha was founded in 2010", claims)).toBe(claims[0]);
    expect(findClaim('"the company\'s headcount is about 1,200 people."', claims)).toBe(claims[1]);
  });
  it("returns null for quotes not in any claim, or too short to be meaningful", () => {
    expect(findClaim("Zerodha was founded in 2009", claims)).toBeNull();
    expect(findClaim("2010", claims)).toBeNull();
  });
});

describe("valueInQuote", () => {
  it("requires a year to appear in the quote", () => {
    expect(valueInQuote(f.founded, 2010, "founded in 2010", [])).toBe(true);
    expect(valueInQuote(f.founded, 2011, "founded in 2010", [])).toBe(false);
  });
  it("requires a number field's quote to contain a number", () => {
    expect(valueInQuote(f.staff, 1200, "about 1,200 people", [])).toBe(true);
    expect(valueInQuote(f.staff, 1200, "about a thousand people", [])).toBe(false);
  });
  it("accepts a URL that is (a page above) one of the claim's sources", () => {
    expect(valueInQuote(f.website, "https://zerodha.com", "founded in 2010", [sources[0]!])).toBe(true);
    expect(valueInQuote(f.website, "https://zerodha.in", "founded in 2010", [sources[0]!])).toBe(false);
    const profile = { url: "https://www.linkedin.com/company/zerodha", title: "LinkedIn" };
    expect(valueInQuote(f.website, "https://linkedin.com/company/zerodha/", "x", [profile])).toBe(true);
    expect(valueInQuote(f.website, "https://linkedin.com/company/other", "x", [profile])).toBe(false);
  });
  it("trusts a URL in the quote only when the claim was read from a page", () => {
    // The search model's own sentence: it may have written the URL from memory.
    expect(valueInQuote(f.website, "https://zerodha.com", "its site is zerodha.com", [])).toBe(false);
    const quote = "The official website of Zerodha (https://zerodha.com) links to its LinkedIn page: https://www.linkedin.com/company/zerodha_broking.";
    expect(valueInQuote(f.website, "https://www.linkedin.com/company/zerodha_broking", quote, [], true)).toBe(true);
    // The whole URL must be there, not just its host.
    expect(valueInQuote(f.website, "https://www.linkedin.com/company/acme", quote, [], true)).toBe(false);
  });
});

describe("checkEvidence", () => {
  const fields = [f.founded, f.website, f.founders, f.ceo];

  it("keeps quoted values, taking quote sources from the claim", () => {
    const checked = checkEvidence(
      fields,
      {
        founded: { value: 2010, quotes: ["Zerodha was founded in 2010"] },
        website: { value: "https://zerodha.com", quotes: ["Zerodha was founded in 2010 by Nithin Kamath"] },
        founders: {
          items: [
            { value: "Nithin Kamath", quotes: ["by Nithin Kamath and Nikhil Kamath"] },
            { value: "Nikhil Kamath", quotes: ["by Nithin Kamath and Nikhil Kamath"] },
          ],
        },
        ceo: { value: null, quotes: [] },
      },
      claims,
      sources,
    );
    expect(checked.output).toEqual({
      founded: 2010,
      website: "https://zerodha.com",
      founders: ["Nithin Kamath", "Nikhil Kamath"],
      ceo: null,
    });
    expect(checked.evidence.founded).toEqual({ quotes: [{ text: "Zerodha was founded in 2010", sources: [1, 3], origin: "search" }] });
    expect(checked.evidence.founders?.quotes).toHaveLength(2);
    expect(checked.evidence.ceo).toEqual({ quotes: [], blank: "not_found" });
  });

  it("blanks values without a matching quote as unsupported, and drops unquoted list items", () => {
    const checked = checkEvidence(
      fields,
      {
        founded: { value: 2011, quotes: ["Zerodha was founded in 2010"] },
        website: { value: "https://zerodha.com", quotes: ["Zerodha's site is zerodha.com"] },
        founders: {
          items: [
            { value: "Nithin Kamath", quotes: ["by Nithin Kamath and Nikhil Kamath"] },
            { value: "nithin kamath", quotes: ["by Nithin Kamath and Nikhil Kamath"] },
            { value: "Rainmatter", quotes: ["Rainmatter is its incubator"] },
          ],
        },
        ceo: { value: "Nithin Kamath", quotes: [] },
      },
      claims,
      sources,
    );
    expect(checked.output).toEqual({ founded: null, website: null, founders: ["Nithin Kamath"], ceo: null });
    expect(checked.evidence.founded?.blank).toBe("unsupported");
    expect(checked.evidence.website?.blank).toBe("unsupported");
    expect(checked.evidence.ceo?.blank).toBe("not_found");
  });

  it("joins a value's quotes into one, with every claim's sources, dropping quotes in no claim", () => {
    const checked = checkEvidence(
      [f.ceo, f.founders],
      {
        ceo: { value: "Zerodha, 1,200 staff", quotes: ["Zerodha was founded in 2010", "headcount is about 1,200 people", "it is India's largest broker"] },
        founders: { items: [{ value: "Nithin Kamath", quotes: ["by Nithin Kamath", "Nithin Kamath is its CEO"] }] },
      },
      claims,
      sources,
    );
    expect(checked.evidence.ceo).toEqual({
      quotes: [{ text: "Zerodha was founded in 2010 … headcount is about 1,200 people", sources: [1, 2, 3], origin: "search" }],
    });
    expect(checked.evidence.founders).toEqual({ quotes: [{ text: "by Nithin Kamath", sources: [1, 3], origin: "search" }] });
  });

  it("marks a list unsupported when every item lacks a quote", () => {
    const checked = checkEvidence([f.founders], { founders: { items: [{ value: "X", quotes: ["X founded it"] }] } }, claims, sources);
    expect(checked).toEqual({
      output: { founders: null },
      evidence: { founders: { quotes: [], blank: "unsupported" } },
      // Kept for debugging: what extraction gave and why it was dropped.
      rejected: { founders: [{ value: "X", quotes: ["X founded it"], reason: "unsupported" }] },
    });
  });

  it("treats malformed or missing cells as not found", () => {
    const checked = checkEvidence([f.founded, f.founders], {}, claims, sources);
    expect(checked).toEqual(allBlank([f.founded, f.founders], "not_found"));
  });
});

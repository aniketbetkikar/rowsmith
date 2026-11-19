import { describe, expect, it } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import { checkEvidence } from "./evidence";
import type { FetchLike } from "./page";
import { choosePages, fieldTerms, readPages, selectPassages } from "./read-pages";
import type { Grounding, TieredSource } from "./search";

const config: JobConfig = {
  keyColumn: "name",
  entityDescription: "Global companies",
  contextColumns: [],
  fields: [
    { name: "employees", type: "number", description: "Total number of full-time employees, latest reported" },
    { name: "hq_city", type: "text", description: "City of the global headquarters" },
  ],
};
const row = { key: "Apple", input: { name: "Apple" } };

const src = (url: string, tier: TieredSource["tier"]): TieredSource => ({ url, title: url, tier });

function fakeFetch(pages: Record<string, string>): FetchLike {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = pages[url];
    return body === undefined ? new Response("", { status: 403 }) : new Response(body, { status: 200 });
  }) as FetchLike;
}

describe("choosePages", () => {
  const sources = [
    src("https://www.sec.gov/apple-10k.htm", "authority"),
    src("https://www.apple.com/newsroom/results/", "official"),
    src("https://investor.apple.com/report.pdf", "official"),
    src("https://investor.apple.com/other.pdf", "official"),
    src("https://en.wikipedia.org/wiki/Apple_Inc.", "reference"),
    src("https://www.wikidata.org/wiki/Q312", "reference"),
    src("https://some-blog.com/apple", "web"),
    src("https://filings.example/apple", "web"),
    src("https://blocked.example/apple", "web"),
  ];
  it("reads own pages, then plan sites (registries first), then authority pages; one PDF at most; no Wikipedia", () => {
    expect(choosePages(sources, config, row, 10)).toEqual([2, 3, 1]);
    const planned = {
      ...config,
      sites: [
        { host: "filings.example", role: "registry" as const, scope: null, status: "readable" as const },
        { host: "blocked.example", role: "listing" as const, scope: null, status: "search_only" as const },
      ],
    };
    expect(choosePages(sources, planned, row, 10)).toEqual([2, 3, 8, 1]);
    expect(choosePages(sources, planned, row, 2)).toEqual([2, 3]);
  });
  it("uses a scope's sites only for rows in that scope", () => {
    const planned = {
      ...config,
      scopeColumn: "country",
      sites: [{ host: "filings.example", role: "registry" as const, scope: "Japan", status: "readable" as const }],
    };
    expect(choosePages(sources, planned, { key: "Apple", input: { country: "japan" } }, 10)).toContain(8);
    expect(choosePages(sources, planned, { key: "Apple", input: { country: "USA" } }, 10)).not.toContain(8);
  });
});

describe("selectPassages", () => {
  it("keeps the opening and the passages about the fields, in page order, within budget", () => {
    const terms = fieldTerms(config.fields);
    const passages = [
      "Apple Inc. is an American technology company.",
      "It was founded in 1976.",
      "Its logo is an apple.",
      "The company sells phones in many shops.",
      "Apple employs about 166,000 full-time employees worldwide.",
      "Its headquarters are in Cupertino, a city in California.",
    ];
    expect(selectPassages(passages, terms, 10_000)).toEqual([
      passages[0],
      passages[1],
      passages[2],
      passages[4],
      passages[5],
    ]);
    // Over budget, the most relevant passages win.
    expect(selectPassages(passages, terms, 60)).toEqual([passages[0]]);
  });
});

describe("readPages", () => {
  const sources = [
    src("https://en.wikipedia.org/wiki/Apple_Inc.", "reference"),
    src("https://www.apple.com/blocked/", "official"),
  ];
  const article = { lang: "en", title: "Apple Inc.", url: "https://en.wikipedia.org/wiki/Apple_Inc.", html: "" };
  const grounding: Grounding = {
    notes: "",
    sources,
    claims: [{ text: "Apple has a large workforce, according to the search.", sources: [1] }],
  };
  const page =
    '<html><body><table class="infobox"><tr><th>Number of employees</th><td>166,000 (2025)</td></tr></table>' +
    "<p>Apple is headquartered in Cupertino, California, in a ring-shaped campus.</p></body></html>";

  it("adds the pages' own text as page claims, keeping the search's claims as fallback", async () => {
    // The checked article is used as fetched; the blocked official page is skipped.
    const read = await readPages(grounding, config, row, { article: { ...article, html: page }, fetchImpl: fakeFetch({}) });
    expect(read.claims).toEqual([
      { text: "Apple has a large workforce, according to the search.", sources: [1] },
      { text: "Number of employees: 166,000 (2025)", sources: [1], origin: "page" },
      { text: "Apple is headquartered in Cupertino, California, in a ring-shaped campus.", sources: [1], origin: "page" },
    ]);
    expect(read.notes).toContain("Page text (copied from the sources in brackets; quote these first):\n- Number of employees: 166,000 (2025) [S1]");
    expect(read.notes).toContain("Search summary (the search model's own words about the sources in brackets):\n- Apple has a large workforce");

    // A value quoted from page text is stored as page evidence.
    const checked = checkEvidence(
      config.fields,
      { employees: { value: 166000, quotes: ["Number of employees: 166,000 (2025)"] }, hq_city: { value: null, quotes: [] } },
      read.claims,
      read.sources,
    );
    expect(checked.evidence.employees).toEqual({
      quotes: [{ text: "Number of employees: 166,000 (2025)", sources: [1], origin: "page" }],
    });
  });

  it("adds an article the search didn't cite as a source", async () => {
    const other = { ...article, url: "https://en.wikipedia.org/wiki/Apple_Inc", html: page };
    const read = await readPages({ ...grounding, sources: sources.slice(1) }, config, row, { article: other, fetchImpl: fakeFetch({}) });
    expect(read.sources.at(-1)).toEqual({ url: other.url, title: "Wikipedia: Apple Inc.", tier: "reference" });
    expect(read.claims.find((c) => c.text.startsWith("Number of employees"))?.sources).toEqual([2]);
  });

  it("returns the grounding unchanged when no page can be read", async () => {
    expect(await readPages(grounding, config, row, { fetchImpl: fakeFetch({}) })).toBe(grounding);
    const notHtml = fakeFetch({ "https://www.apple.com/blocked/": "plain text, no markup" });
    expect(await readPages(grounding, config, row, { fetchImpl: notHtml })).toBe(grounding);
  });
});

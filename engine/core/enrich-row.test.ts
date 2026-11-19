import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import { ConfigError } from "@engine/utils/errors";
import { enrichRow } from "./enrich-row";
import { extractStructured } from "./extract";
import { groundedSearch } from "./search";

vi.mock("./search", () => ({ groundedSearch: vi.fn() }));
vi.mock("./extract", () => ({ extractStructured: vi.fn() }));
// Anchors read pages over the network; tested on their own in anchors.test.ts.
vi.mock("./anchors", () => ({ addAnchors: vi.fn(async (grounding: unknown) => grounding) }));
vi.mock("./read-pages", () => ({ readPages: vi.fn(async (grounding: unknown) => grounding) }));
vi.mock("./entity-article", () => ({ findArticle: vi.fn(async () => null) }));
vi.mock("@engine/llm/models", async (importOriginal) => {
  const thinking = { default: "low", levels: ["low"] } as const;
  return {
    ...(await importOriginal<typeof import("@engine/llm/models")>()),
    MODEL_CATALOG: {
      "search-model": { price: { input: 1, cachedInput: 0.5, output: 2 }, thinking },
      "extract-model": { price: { input: 10, cachedInput: 5, output: 20 }, thinking },
    },
    SEARCH_PRICE_PER_CALL: 0.01,
  };
});

const search = vi.mocked(groundedSearch);
const extract = vi.mocked(extractStructured);

const config: JobConfig = {
  keyColumn: "name",
  entityDescription: "Software companies",
  contextColumns: [],
  fields: [
    { name: "founded", type: "year", description: "Year founded" },
    { name: "website", type: "url", description: "Official site" },
    { name: "founders", type: "list", description: "Co-founders" },
  ],
};
const row = { key: "Notion", input: { name: "Notion" } };

const claims = [
  { text: "Notion was founded in 2013 by Ivan Zhao and Simon Last.", sources: [1] },
  { text: "Its official website is notion.so.", sources: [1, 2] },
];
const searchResult = {
  notes: "Sources: … Claims: …",
  sources: [
    { url: "https://notion.so/about", title: "notion.so", tier: "official" as const },
    { url: "https://en.wikipedia.org/wiki/Notion", title: "wikipedia.org", tier: "web" as const },
  ],
  claims,
  usage: { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 },
  searchCalls: 2,
  model: "search-model",
};
/** Rows store sources without their tier. */
const stored = searchResult.sources.map(({ url, title }) => ({ url, title }));
const extractUsage = { inputTokens: 100_000, outputTokens: 0, cachedTokens: 0 };

const good = {
  founded: { value: 2013, quotes: ["Notion was founded in 2013"] },
  website: { value: "https://notion.so", quotes: ["Its official website is notion.so"] },
  founders: {
    items: [
      { value: "Ivan Zhao", quotes: ["founded in 2013 by Ivan Zhao and Simon Last"] },
      { value: "Simon Last", quotes: ["founded in 2013 by Ivan Zhao and Simon Last"] },
    ],
  },
};
const allSupported = {
  checks: ["founded", "website", "founders#1", "founders#2"].map((id) => ({ id, supported: true })),
};

function reply(parsed: unknown, issues: string[] = []) {
  return { parsed, issues, usage: extractUsage, model: "extract-model" };
}

// $1 search tokens + 2 × $0.01 search calls; each extract or verify call is $1.
const SEARCH_COST = 1 + 0.02;
const CALL_COST = 1;

beforeEach(() => {
  search.mockReset();
  extract.mockReset();
});

describe("enrichRow", () => {
  it("returns verified values with their quotes and grounded sources", async () => {
    search.mockResolvedValue(searchResult);
    extract.mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply(allSupported));

    const result = await enrichRow(config, row);

    expect(result).toMatchObject({
      status: "done",
      output: { founded: 2013, website: "https://notion.so", founders: ["Ivan Zhao", "Simon Last"] },
      sources: stored,
      attempts: 1,
      usage: { inputTokens: 1_200_000, outputTokens: 0, cachedTokens: 0, searchCalls: 2 },
    });
    expect(result.evidence.founded).toEqual({ quotes: [{ text: "Notion was founded in 2013", sources: [1], origin: "search" }] });
    expect(result.evidence.website?.quotes[0]?.sources).toEqual([1, 2]);
    expect(result.evidence.founders?.quotes).toHaveLength(2);
    expect(result.costUsd).toBeCloseTo(SEARCH_COST + 2 * CALL_COST, 10);
    expect(extract.mock.calls[1]?.[2]).toContain('[founders#2] founders: "Simon Last"');
  });

  it("blanks values whose quote isn't in the grounded claims, before verify", async () => {
    search.mockResolvedValue(searchResult);
    const invented = {
      ...good,
      founded: { value: 2012, quotes: ["Notion launched publicly in 2012"] },
      founders: { items: [{ value: "Ivan Zhao", quotes: ["founded in 2013 by Ivan Zhao"] }, { value: "Chris Prucha", quotes: ["Chris Prucha co-founded Notion"] }] },
    };
    extract.mockResolvedValueOnce(reply(invented)).mockResolvedValueOnce(reply(allSupported));

    const result = await enrichRow(config, row);

    expect(result.output).toEqual({ founded: null, website: "https://notion.so", founders: ["Ivan Zhao"] });
    expect(result.evidence.founded).toEqual({ quotes: [], blank: "unsupported" });
    const verifyPrompt = extract.mock.calls[1]?.[2] ?? "";
    expect(verifyPrompt).not.toContain("Chris Prucha");
    expect(verifyPrompt).not.toContain("[founded]");
  });

  it("drops values the verify pass doesn't support", async () => {
    search.mockResolvedValue(searchResult);
    extract.mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(
      reply({ checks: [{ id: "founded", supported: true }, { id: "website", supported: false }, { id: "founders#1", supported: true }, { id: "founders#2", supported: false }] }),
    );

    const result = await enrichRow(config, row);

    expect(result.output).toEqual({ founded: 2013, website: null, founders: ["Ivan Zhao"] });
    expect(result.evidence.website).toEqual({ quotes: [], blank: "rejected" });
    expect(result.evidence.founders?.quotes).toHaveLength(1);
  });

  it("marks values the model left null as not found and skips verify when nothing is filled", async () => {
    search.mockResolvedValue(searchResult);
    extract.mockResolvedValueOnce(
      reply({ founded: { value: null, quotes: [] }, website: { value: null, quotes: [] }, founders: { items: [] } }),
    );

    const result = await enrichRow(config, row);

    expect(result.output).toEqual({ founded: null, website: null, founders: null });
    expect(result.evidence.founders).toEqual({ quotes: [], blank: "not_found" });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("searches once more, insisting, when nothing was grounded", async () => {
    search.mockResolvedValueOnce({ ...searchResult, sources: [], claims: [] }).mockResolvedValueOnce(searchResult);
    extract.mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply(allSupported));

    const result = await enrichRow(config, row);

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0]?.[0]).not.toContain("Search the web before answering");
    expect(search.mock.calls[1]?.[0]).toContain("Search the web before answering");
    expect(result).toMatchObject({ status: "done", sources: stored, usage: { searchCalls: 4 } });
    expect(result.costUsd).toBeCloseTo(2 * SEARCH_COST + 2 * CALL_COST, 10);
  });

  it("returns all-null output without extracting when both searches find no sources", async () => {
    search.mockResolvedValue({ ...searchResult, sources: [], claims: [] });

    const result = await enrichRow(config, row);

    expect(result).toMatchObject({
      status: "done",
      output: { founded: null, website: null, founders: null },
      sources: [],
      attempts: 0,
    });
    expect(result.evidence.founded).toEqual({ quotes: [], blank: "not_found" });
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.costUsd).toBeCloseTo(2 * SEARCH_COST, 10);
    expect(extract).not.toHaveBeenCalled();
  });

  it("retries extraction with the validation issues fed back, reusing the same notes", async () => {
    search.mockResolvedValue(searchResult);
    extract
      .mockResolvedValueOnce(reply(null, ["founded.value: Too big"]))
      .mockResolvedValueOnce(reply(good))
      .mockResolvedValueOnce(reply(allSupported));

    const result = await enrichRow(config, row);

    expect(result).toMatchObject({ status: "done", attempts: 2 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]?.[2]).not.toContain("failed validation");
    expect(extract.mock.calls[1]?.[2]).toContain("failed validation: founded.value: Too big");
    expect(extract.mock.calls[1]?.[2]).toContain(searchResult.notes);
    expect(result.costUsd).toBeCloseTo(SEARCH_COST + 3 * CALL_COST, 10);
  });

  it("fails after 1 + MAX_RETRIES (3) extraction attempts, counting every attempt's cost", async () => {
    search.mockResolvedValue(searchResult);
    extract.mockResolvedValue(reply(null, ["website.value: Invalid URL"]));

    const result = await enrichRow(config, row);

    expect(extract).toHaveBeenCalledTimes(3);
    // Only the last attempt goes to the stronger model.
    expect(extract.mock.calls.map((c) => c[0])).toEqual(["extract", "extract", "rescue"]);
    expect(result).toMatchObject({ status: "failed", output: null, attempts: 3, evidence: {} });
    expect(result.error).toContain("website.value: Invalid URL");
    expect(result.usage.inputTokens).toBe(1_000_000 + 3 * 100_000);
    expect(result.costUsd).toBeCloseTo(SEARCH_COST + 3 * CALL_COST, 10);
  });

  it("fails the row when verification never returns valid verdicts", async () => {
    search.mockResolvedValue(searchResult);
    extract.mockResolvedValueOnce(reply(good)).mockResolvedValue(reply(null, ["checks: Required"]));

    const result = await enrichRow(config, row);

    expect(result).toMatchObject({ status: "failed", output: null });
    expect(result.error).toContain("Verification failed");
    expect(extract).toHaveBeenCalledTimes(4);
    // Verify keeps its own model on every retry.
    expect(extract.mock.calls.map((c) => c[0])).toEqual(["extract", "verify", "verify", "verify"]);
  });

  it("re-throws transient errors so BullMQ retries the row", async () => {
    search.mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 }));
    await expect(enrichRow(config, row)).rejects.toThrow("rate limited");

    search.mockResolvedValue(searchResult);
    extract.mockRejectedValue(Object.assign(new Error("upstream"), { status: 503 }));
    await expect(enrichRow(config, row)).rejects.toThrow("upstream");
  });

  it("re-throws config errors", async () => {
    search.mockRejectedValue(new ConfigError("No price entry"));
    await expect(enrichRow(config, row)).rejects.toThrow(ConfigError);
  });

  it("marks the row failed with a reason on non-transient errors, keeping cost so far", async () => {
    search.mockResolvedValue(searchResult);
    extract.mockRejectedValue(Object.assign(new Error("bad request"), { status: 400 }));

    const result = await enrichRow(config, row);

    expect(result).toMatchObject({
      status: "failed",
      output: null,
      error: "bad request",
      sources: stored,
      attempts: 1,
    });
    expect(result.costUsd).toBeCloseTo(SEARCH_COST, 10);
  });
});

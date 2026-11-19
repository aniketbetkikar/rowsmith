import { describe, expect, it, vi } from "vitest";
import type { FieldDef, JobConfig } from "@engine/contracts/job-config";
import { MAX_ROW_SOURCES, MAX_SEARCHES_PER_ROW } from "@engine/config/limits";
import { mergeGroundings, planSearches, research } from "./research";
import type { Grounding, TieredSource } from "./search";

const scalar = (name: string): FieldDef => ({ name, type: "text", description: name });
const list = (name: string): FieldDef => ({ name, type: "list", description: name });
const names = (groups: FieldDef[][]) => groups.map((g) => g.map((f) => f.name));

describe("planSearches", () => {
  it("uses one search for a few facts, even with a single list", () => {
    expect(names(planSearches([scalar("a"), list("b"), scalar("c")]))).toEqual([["a", "b", "c"]]);
  });

  it("gives each list its own search when there are 2+", () => {
    expect(names(planSearches([list("b"), list("c")]))).toEqual([["b"], ["c"]]);
  });

  it("splits many shared fields into searches of 10", () => {
    const fields = Array.from({ length: 12 }, (_, i) => scalar(`f${i}`));
    expect(planSearches(fields).map((g) => g.length)).toEqual([10, 2]);
  });

  it(`merges groups round-robin past ${MAX_SEARCHES_PER_ROW} searches, keeping config order`, () => {
    const fields = [scalar("s"), ...Array.from({ length: 6 }, (_, i) => list(`l${i}`))];
    const groups = planSearches(fields);
    expect(groups).toHaveLength(MAX_SEARCHES_PER_ROW);
    expect(groups.flat().map((f) => f.name).sort()).toEqual(fields.map((f) => f.name).sort());
    const order = fields.map((f) => f.name);
    for (const group of names(groups)) {
      expect(group).toEqual([...group].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    }
    // Lists are spread out rather than piled into one search.
    expect(Math.max(...groups.map((g) => g.length)) - Math.min(...groups.map((g) => g.length))).toBeLessThanOrEqual(1);
  });
});

const src = (host: string, tier: TieredSource["tier"] = "web"): TieredSource => ({
  url: `https://${host}/`,
  title: host,
  tier,
});

function grounding(sources: TieredSource[], claims: Grounding["claims"]): Grounding {
  return { notes: "", sources, claims };
}

describe("mergeGroundings", () => {
  it("dedupes sources by URL, re-ranks them by tier and renumbers claims", () => {
    const merged = mergeGroundings([
      grounding([src("blog.com"), src("a.gov", "authority")], [
        { text: "A from blog.", sources: [1] },
        { text: "B.", sources: [1, 2] },
      ]),
      grounding([src("acme.com", "official"), src("blog.com")], [
        { text: "C.", sources: [1] },
        { text: "B.", sources: [2] },
      ]),
    ]);
    expect(merged.sources.map((s) => s.title)).toEqual(["acme.com", "a.gov", "blog.com"]);
    expect(merged.claims).toEqual([
      { text: "A from blog.", sources: [3] },
      { text: "B.", sources: [2, 3] },
      { text: "C.", sources: [1] },
    ]);
    expect(merged.notes).toContain("[S1] official: acme.com");
    expect(merged.notes).toContain("- B. [S2, S3]");
  });

  it(`caps sources at ${MAX_ROW_SOURCES}, dropping claims backed only by dropped ones`, () => {
    const many = Array.from({ length: MAX_ROW_SOURCES }, (_, i) => src(`s${i}.com`));
    const merged = mergeGroundings([
      grounding(many, many.map((_, i) => ({ text: `Claim ${i}.`, sources: [i + 1] }))),
      grounding([src("forum.reddit.com", "community")], [{ text: "Only on a forum.", sources: [1] }]),
    ]);
    expect(merged.sources).toHaveLength(MAX_ROW_SOURCES);
    expect(merged.claims.map((c) => c.text)).not.toContain("Only on a forum.");
  });

  it("returns empty notes when nothing was grounded", () => {
    expect(mergeGroundings([grounding([], []), grounding([], [])])).toEqual({ notes: "", sources: [], claims: [] });
  });
});

describe("research", () => {
  const config: JobConfig = {
    keyColumn: "name",
    entityDescription: "Companies",
    contextColumns: [],
    fields: [list("partners"), list("revenue_streams")],
  };
  const row = { key: "Acme", input: { name: "Acme" } };

  it("runs one search per group, each covering only its fields, and merges them", async () => {
    const search = vi.fn(async (prompt: string) =>
      grounding([src(prompt.includes("- partners") ? "p.com" : "r.com")], [
        { text: `Fact from ${prompt.length}.`, sources: [1] },
      ]),
    );
    const result = await research(config, row, search);

    expect(search).toHaveBeenCalledTimes(2);
    const prompts = search.mock.calls.map((c) => c[0]);
    expect(prompts[0]).toContain("- partners");
    expect(prompts[0]).not.toContain("- revenue_streams");
    expect(prompts[1]).toContain("- revenue_streams");
    expect(result.sources.map((s) => s.title).sort()).toEqual(["p.com", "r.com"]);
  });

  it("retries only the searches that came back with nothing grounded", async () => {
    const search = vi.fn(async (prompt: string) =>
      prompt.includes("- partners") && !prompt.includes("Search the web before answering")
        ? grounding([], [])
        : grounding([src("x.com")], [{ text: "Fact.", sources: [1] }]),
    );
    await research(config, row, search);

    expect(search).toHaveBeenCalledTimes(3);
    const retries = search.mock.calls.map((c) => c[0]).filter((p) => p.includes("Search the web before answering"));
    expect(retries).toHaveLength(1);
    expect(retries[0]).toContain("- partners");
  });

  it("returns a single search's grounding unchanged", async () => {
    const only = grounding([src("x.com")], [{ text: "Fact.", sources: [1] }]);
    const result = await research({ ...config, fields: [scalar("ceo"), list("partners")] }, row, vi.fn(async () => only));
    expect(result).toBe(only);
  });
});

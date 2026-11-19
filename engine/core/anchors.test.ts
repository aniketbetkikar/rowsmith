import { describe, expect, it } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import { addAnchors, namesMatch, officialCandidates, profileOf, siteOf } from "./anchors";
import { checkEvidence } from "./evidence";
import type { FetchLike } from "./page";
import type { Grounding, TieredSource } from "./search";

const config: JobConfig = {
  keyColumn: "name",
  entityDescription: "Global companies",
  contextColumns: [],
  fields: [
    { name: "website", type: "url", description: "Official homepage URL" },
    { name: "linkedin_url", type: "url", description: "Official LinkedIn company page URL" },
  ],
};

/** A fake fetch serving fixed bodies by exact URL (anything else is a 404). */
function fakeFetch(pages: Record<string, string | { body: string; finalUrl: string }>): FetchLike {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const page = pages[url];
    if (page === undefined) return new Response("not found", { status: 404 });
    const { body, finalUrl } = typeof page === "string" ? { body: page, finalUrl: url } : page;
    const res = new Response(body, { status: 200 });
    Object.defineProperty(res, "url", { value: finalUrl });
    return res;
  }) as FetchLike;
}

function grounding(sources: TieredSource[], claims: Grounding["claims"] = []): Grounding {
  return { notes: "", sources, claims: claims.length > 0 ? claims : [{ text: "x", sources: sources.map((_, i) => i + 1) }] };
}

const wikiApi = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
    action: "query",
    format: "json",
    prop: "pageprops",
    ppprop: "wikibase_item|disambiguation",
    redirects: "1",
    titles: title,
  }).toString()}`;

const statement = (value: string, extra: Record<string, unknown> = {}) => ({
  mainsnak: { datavalue: { value } },
  rank: "normal",
  ...extra,
});

describe("namesMatch", () => {
  it("matches the whole key or one of its distinctive words", () => {
    expect(namesMatch("Apple", "Apple")).toBe(true);
    expect(namesMatch("Red Bull", "Red Bull Energy Drink - Official Website")).toBe(true);
    expect(namesMatch("Anheuser-Busch InBev", "AB InBev | Home")).toBe(true);
    expect(namesMatch("Nestlé", "Nestle Global")).toBe(true);
  });
  it("ignores generic words such as Group or Inc", () => {
    expect(namesMatch("Alibaba Group", "Group Holdings Ltd")).toBe(false);
    expect(namesMatch("Apple", "Domain for sale")).toBe(false);
  });
});

describe("siteOf", () => {
  it("cuts a host to the site it belongs to", () => {
    expect(siteOf("investors.spotify.com")).toBe("spotify.com");
    expect(siteOf("shop.unilever.co.uk")).toBe("unilever.co.uk");
    expect(siteOf("global.toyota")).toBe("global.toyota");
  });
});

describe("profileOf", () => {
  it("canonicalises profile links and skips share links", () => {
    expect(profileOf("https://in.linkedin.com/company/zerodha/?trk=footer")).toEqual({
      label: "LinkedIn page",
      url: "https://www.linkedin.com/company/zerodha",
    });
    expect(profileOf("https://twitter.com/zerodhaonline")?.url).toBe("https://x.com/zerodhaonline");
    expect(profileOf("https://www.linkedin.com/shareArticle?url=x")).toBeNull();
    expect(profileOf("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(profileOf("https://x.com/intent/tweet")).toBeNull();
    expect(profileOf("https://www.instagram.com/p/abc123/")).toBeNull();
  });
});

describe("officialCandidates", () => {
  it("puts the row's own URL first, then sources named after the key, then sites a claim names", () => {
    const row = { key: "Zerodha", input: { name: "Zerodha", site: "zerodha.com" } };
    const g = grounding(
      [{ url: "https://support.zerodha.com/a", title: "Support", tier: "official" }],
      [{ text: "Zerodha's official website is https://kite.trade.", sources: [1] }],
    );
    expect(officialCandidates(row, g, null, {}).map((c) => [c.host, c.via])).toEqual([
      ["zerodha.com", "row"],
      ["kite.trade", "claim"],
    ]);
  });
  it("never takes a reference or profile site for the official one", () => {
    const row = { key: "Acme", input: {} };
    const g = grounding(
      [{ url: "https://en.wikipedia.org/wiki/Acme", title: "W", tier: "reference" }],
      [{ text: "Acme's website is listed on wikipedia.org and linkedin.com.", sources: [1] }],
    );
    expect(officialCandidates(row, g, null, {})).toEqual([]);
  });
});

describe("addAnchors", () => {
  it("fills Apple's website and LinkedIn from Wikidata and its confirmed homepage", async () => {
    const row = { key: "Apple", input: { name: "Apple" } };
    const g = grounding([
      { url: "https://www.apple.com/newsroom/2026/11/results/", title: "apple.com", tier: "official" },
      { url: "https://en.wikipedia.org/wiki/Apple_Inc.", title: "wikipedia.org", tier: "reference" },
    ]);
    const fetchImpl = fakeFetch({
      [wikiApi("en", "Apple Inc.")]: JSON.stringify({ query: { pages: { "856": { pageprops: { wikibase_item: "Q312" } } } } }),
      "https://www.wikidata.org/wiki/Special:EntityData/Q312.json": JSON.stringify({
        entities: {
          Q312: {
            claims: {
              P856: [statement("https://www.apple.com/")],
              P4264: [statement("apple-old", { rank: "deprecated" }), statement("apple")],
            },
          },
        },
      }),
      "https://apple.com/": { body: "<html><head><title>Apple</title></head><body></body></html>", finalUrl: "https://www.apple.com/" },
    });

    const anchored = await addAnchors(g, config, row, { fetchImpl, article: { lang: "en", title: "Apple Inc." } });
    const texts = anchored.claims.map((c) => c.text);
    // The homepage we read states the website; Wikidata's copy is left out.
    expect(texts.join(" ")).not.toContain("Wikidata lists the official website");
    expect(texts).toContain("Wikidata lists the LinkedIn page of Apple as https://www.linkedin.com/company/apple.");
    expect(texts).toContain("The official website of Apple is https://www.apple.com.");
    expect(texts.join(" ")).not.toContain("apple-old");

    const checked = checkEvidence(
      config.fields,
      {
        website: { value: "https://www.apple.com", quotes: ["The official website of Apple is https://www.apple.com"] },
        linkedin_url: {
          value: "https://www.linkedin.com/company/apple",
          quotes: ["Wikidata lists the LinkedIn page of Apple as https://www.linkedin.com/company/apple"],
        },
      },
      anchored.claims,
      anchored.sources,
    );
    expect(checked.output).toEqual({
      website: "https://www.apple.com",
      linkedin_url: "https://www.linkedin.com/company/apple",
    });
  });

  it("reads the profiles an official homepage links to", async () => {
    const row = { key: "Zerodha", input: { name: "Zerodha" } };
    const g = grounding([{ url: "https://zerodha.com/about/", title: "zerodha.com", tier: "official" }]);
    const home =
      '<title>Zerodha - India&#39;s biggest stock broker</title>' +
      '<a href="https://www.linkedin.com/company/zerodha/">in</a><a href="https://www.linkedin.com/shareArticle?u=1">share</a>' +
      "<a href='https://twitter.com/zerodhaonline'>x</a><a href=\"/about\">About</a>";
    const anchored = await addAnchors(g, config, row, { fetchImpl: fakeFetch({ "https://zerodha.com/": home }) });
    const texts = anchored.claims.map((c) => c.text);
    expect(texts).toContain(
      "The official website of Zerodha (https://zerodha.com) links to its LinkedIn page: https://www.linkedin.com/company/zerodha.",
    );
    expect(texts).toContain(
      "The official website of Zerodha (https://zerodha.com) links to its X (Twitter) account: https://x.com/zerodhaonline.",
    );
    expect(texts.join(" ")).not.toContain("shareArticle");
    expect(anchored.claims.filter((c) => c.origin === "page")).toHaveLength(3);
  });

  it("rejects a candidate whose homepage doesn't name the entity", async () => {
    const row = { key: "Bolt", input: { name: "Bolt" } };
    const g = grounding(
      [{ url: "https://example.org/bolt", title: "example", tier: "web" }],
      [{ text: "Bolt's website is boltz-parked.com.", sources: [1] }],
    );
    const fetchImpl = fakeFetch({ "https://boltz-parked.com/": "<title>This domain is for sale</title>" });
    const anchored = await addAnchors(g, config, row, { fetchImpl });
    expect(anchored.claims.some((c) => c.origin === "page")).toBe(false);
  });

  it("asks Wikidata nothing without a checked article", async () => {
    const row = { key: "Novo Nordisk", input: { name: "Novo Nordisk" } };
    const g = grounding([{ url: "https://en.wikipedia.org/wiki/Novo_(company)", title: "W", tier: "reference" }]);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: 404 });
    }) as FetchLike;
    await addAnchors(g, config, row, { fetchImpl });
    expect(calls).toBe(0);
  });

  it("does nothing without a URL field, and never throws", async () => {
    const row = { key: "Apple", input: {} };
    const g = grounding([{ url: "https://www.apple.com/", title: "apple.com", tier: "official" }]);
    const noUrl = { ...config, fields: [{ name: "ceo", type: "text" as const, description: "Current CEO" }] };
    expect(await addAnchors(g, noUrl, row, { fetchImpl: fakeFetch({}) })).toBe(g);
    const broken = (async () => {
      throw new Error("network down");
    }) as FetchLike;
    const anchored = await addAnchors(g, config, row, { fetchImpl: broken, article: { lang: "en", title: "Apple Inc." } });
    expect(anchored.claims.map((c) => c.text)).toEqual(["x"]);
  });
});

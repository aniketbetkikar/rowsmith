import type { GenerateContentResponse } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { MAX_SOURCES } from "@engine/config/limits";
import { citedChunks, cleanUrl, countSearchCalls, groundedNotes, resolveUrl, searchUsage } from "./search";

type Grounded = Pick<GenerateContentResponse, "candidates" | "usageMetadata">;

function grounded(chunks: { uri?: string; title?: string }[], queries: string[] = []): Grounded {
  return {
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: chunks.map((web) => ({ web })),
          webSearchQueries: queries,
        },
      },
    ],
  };
}

describe("cleanUrl", () => {
  it("removes utm_* params and keeps others", () => {
    expect(cleanUrl("https://a.com/x?utm_source=x&id=7")).toBe("https://a.com/x?id=7");
    expect(cleanUrl("https://a.com/?utm_medium=y")).toBe("https://a.com/");
  });
  it("returns unparseable input unchanged", () => {
    expect(cleanUrl("not a url")).toBe("not a url");
  });
});

type Support = { text?: string; chunks: number[] };

function withSupports(chunks: { uri?: string; title?: string }[], supports: Support[]): Grounded {
  return {
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: chunks.map((web) => ({ web })),
          groundingSupports: supports.map((s) => ({
            segment: s.text === undefined ? undefined : { text: s.text },
            groundingChunkIndices: s.chunks,
          })),
        },
      },
    ],
  };
}

const row = { key: "Notion", input: { name: "Notion" } };
const noRedirects = new Map<string, string>();

describe("citedChunks", () => {
  it("keeps only web chunks cited by a claim with text", () => {
    const response = withSupports(
      [{ uri: "https://g.co/r/0", title: "a.com" }, { uri: "https://g.co/r/1" }, { title: "no uri" }, { uri: "https://g.co/r/3" }],
      [{ text: "Fact.", chunks: [0, 1, 2] }, { chunks: [3] }],
    );
    expect([...citedChunks(response)]).toEqual([
      [0, { uri: "https://g.co/r/0", title: "a.com" }],
      [1, { uri: "https://g.co/r/1", title: "https://g.co/r/1" }],
    ]);
  });
});

describe("groundedNotes", () => {
  it("keeps only cited claims, tagged with their sources", () => {
    const response = withSupports(
      [{ uri: "https://en.wikipedia.org/wiki/Notion", title: "wikipedia.org" }],
      [{ text: "Notion was founded in 2013.", chunks: [0] }],
    );
    const { notes, sources, claims } = groundedNotes(response, noRedirects, row);
    expect(notes).toContain("[S1] reference: wikipedia.org (https://en.wikipedia.org/wiki/Notion)");
    expect(notes).toContain("- Notion was founded in 2013. [S1]");
    expect(sources).toEqual([{ url: "https://en.wikipedia.org/wiki/Notion", title: "wikipedia.org", tier: "reference" }]);
    expect(claims).toEqual([{ text: "Notion was founded in 2013.", sources: [1] }]);
  });

  it("drops claims with no citation (the model's own memory)", () => {
    const response = withSupports(
      [{ uri: "https://a.com/", title: "a.com" }],
      [{ text: "Sourced fact.", chunks: [0] }, { text: "Unsourced guess.", chunks: [] }],
    );
    const { notes } = groundedNotes(response, noRedirects, row);
    expect(notes).toContain("Sourced fact.");
    expect(notes).not.toContain("Unsourced guess.");
  });

  it("ranks official, then authority, then web, then community sources", () => {
    const response = withSupports(
      [
        { uri: "https://www.reddit.com/r/x", title: "reddit.com" },
        { uri: "https://blog.example.com/notion", title: "example.com" },
        { uri: "https://www.sec.gov/filing", title: "sec.gov" },
        { uri: "https://www.notion.com/about", title: "notion.com" },
      ],
      [{ text: "Claim.", chunks: [0, 1, 2, 3] }],
    );
    const { notes, sources } = groundedNotes(response, noRedirects, row);
    expect(sources.map((s) => s.title)).toEqual(["notion.com", "sec.gov", "example.com", "reddit.com"]);
    expect(notes).toContain("[S1] official: notion.com");
    expect(notes).toContain("[S4] community: reddit.com");
    expect(notes).toContain("- Claim. [S1, S2, S3, S4]");
  });

  it("tiers unresolved redirect links by the site named in the title", () => {
    const response = withSupports(
      [{ uri: "https://vertexaisearch.cloud.google.com/r/1", title: "notion.com" }],
      [{ text: "Claim.", chunks: [0] }],
    );
    expect(groundedNotes(response, noRedirects, row).notes).toContain("[S1] official: notion.com");
  });

  it("uses resolved URLs, merging chunks that resolve to the same page", () => {
    const response = withSupports(
      [{ uri: "https://g.co/r/1", title: "notion.com" }, { uri: "https://g.co/r/2", title: "notion.com" }],
      [{ text: "A.", chunks: [0] }, { text: "B.", chunks: [1] }, { text: "A.", chunks: [1] }],
    );
    const resolved = new Map([
      ["https://g.co/r/1", "https://www.notion.com/about"],
      ["https://g.co/r/2", "https://www.notion.com/about"],
    ]);
    const { notes, sources } = groundedNotes(response, resolved, row);
    expect(sources).toEqual([{ url: "https://www.notion.com/about", title: "notion.com", tier: "official" }]);
    expect(notes.match(/- A\. \[S1\]/g)).toHaveLength(1);
    expect(notes).toContain("- B. [S1]");
  });

  it("caps sources at MAX_SOURCES and drops claims backed only by dropped sources", () => {
    const chunks = Array.from({ length: MAX_SOURCES + 1 }, (_, i) => ({ uri: `https://s${i}.com/`, title: `s${i}.com` }));
    // The last, lowest-ranked source is community and backs one claim alone.
    chunks[MAX_SOURCES] = { uri: "https://www.reddit.com/r/x", title: "reddit.com" };
    const response = withSupports(chunks, [
      { text: "Kept.", chunks: chunks.slice(0, MAX_SOURCES).map((_, i) => i) },
      { text: "Only on reddit.", chunks: [MAX_SOURCES] },
    ]);
    const { notes, sources } = groundedNotes(response, noRedirects, row);
    expect(sources).toHaveLength(MAX_SOURCES);
    expect(notes).not.toContain("Only on reddit.");
    expect(notes).not.toContain("reddit.com");
  });

  it("returns empty notes and no sources when nothing was grounded", () => {
    expect(groundedNotes({ candidates: [{}] }, noRedirects, row)).toEqual({ notes: "", sources: [], claims: [] });
    expect(groundedNotes({}, noRedirects, row)).toEqual({ notes: "", sources: [], claims: [] });
  });
});

describe("countSearchCalls", () => {
  it("counts the search queries the model ran", () => {
    expect(countSearchCalls(grounded([], ["zerodha founded", "zerodha ceo"]))).toBe(2);
    expect(countSearchCalls({})).toBe(0);
  });
});

describe("searchUsage", () => {
  it("bills thinking as output and tool-use prompt tokens as input", () => {
    expect(
      searchUsage({
        usageMetadata: {
          promptTokenCount: 100,
          toolUsePromptTokenCount: 400,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 30,
          cachedContentTokenCount: 20,
        },
      }),
    ).toEqual({ inputTokens: 500, outputTokens: 80, cachedTokens: 20 });
    expect(searchUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  });
});

describe("resolveUrl", () => {
  const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";

  it("follows the redirect location without downloading the page", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://zerodha.com/about?utm_source=g" } }),
    );
    expect(await resolveUrl(redirect, fetchImpl)).toBe("https://zerodha.com/about");
    expect(fetchImpl).toHaveBeenCalledWith(redirect, expect.objectContaining({ method: "HEAD", redirect: "manual" }));
  });

  it("falls back to the original URL on errors or no redirect", async () => {
    expect(await resolveUrl(redirect, vi.fn(async () => { throw new Error("timeout"); }))).toBe(redirect);
    expect(await resolveUrl(redirect, vi.fn(async () => new Response(null, { status: 200 })))).toBe(redirect);
  });
});

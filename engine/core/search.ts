import type { GenerateContentResponse } from "@google/genai";
import type { Source } from "@engine/contracts/row-result";
import { MAX_SOURCES } from "@engine/config/limits";
import { getGenAI } from "@engine/llm/gemini";
import { genAIConfig, withFallback } from "@engine/llm/models";
import type { RowInput } from "./build-prompt";
import type { TokenUsage } from "./cost";
import { hostOf, SOURCE_TIERS, sourceTier, type SourceTier, type TierHints } from "./source-tier";

/**
 * One grounded statement and the sources (1-based, into `sources`) backing it.
 * `origin: "page"` marks a claim we built from a page we read ourselves (a
 * link on the official site, a Wikidata statement), so any URL in its text
 * really is on that page. Search claims are the search model's own wording.
 */
export type Claim = { text: string; sources: number[]; origin?: "page" };

/** A source with its trust tier (internal: rows store plain Sources). */
export type TieredSource = Source & { tier: SourceTier };

export type Grounding = {
  /** Source list and claims, as shown to the extraction model. */
  notes: string;
  /** Best tier first; S1..Sn in the notes and claims. */
  sources: TieredSource[];
  claims: Claim[];
};

export type SearchResult = Grounding & {
  usage: TokenUsage;
  searchCalls: number;
  model: string;
};

type Grounded = Pick<GenerateContentResponse, "candidates" | "usageMetadata">;

const RESOLVE_TIMEOUT_MS = 3000;

/** Drops tracking params (utm_*) so the same page dedupes to one source. */
export function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

type Chunk = { uri: string; title: string };

function supportsWithText(response: Grounded) {
  const supports = response.candidates?.[0]?.groundingMetadata?.groundingSupports ?? [];
  return supports.flatMap((s) => {
    const text = s.segment?.text?.trim();
    return text ? [{ text, chunks: s.groundingChunkIndices ?? [] }] : [];
  });
}

/** Web chunks cited by at least one grounded claim, keyed by chunk index. */
export function citedChunks(response: Grounded): Map<number, Chunk> {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const cited = new Map<number, Chunk>();
  for (const support of supportsWithText(response)) {
    for (const i of support.chunks) {
      const web = chunks[i]?.web;
      if (web?.uri && !cited.has(i)) cited.set(i, { uri: web.uri, title: web.title || web.uri });
    }
  }
  return cited;
}

type RankedSource = Source & { tier: SourceTier; order: number };

/**
 * Notes built only from claims the search grounded in a source. Text the
 * model wrote without a citation (possibly from its own memory) is dropped.
 * Sources are deduped by resolved URL, ranked by tier (official first) and
 * capped at MAX_SOURCES; a claim backed only by dropped sources is dropped
 * too, so every claim left traces to a stored source.
 *
 * `resolved` maps redirect links to real URLs (missing → link kept).
 */
export function groundedNotes(
  response: Grounded,
  resolved: ReadonlyMap<string, string>,
  row: RowInput,
  hints: TierHints = {},
): Grounding {
  const byUrl = new Map<string, RankedSource>();
  const urlOfChunk = new Map<number, string>();
  for (const [i, chunk] of citedChunks(response)) {
    const url = resolved.get(chunk.uri) ?? chunk.uri;
    urlOfChunk.set(i, url);
    if (byUrl.has(url)) continue;
    // An unresolved redirect link names the site only in its title.
    const host = url === chunk.uri ? (hostOf(chunk.title) ?? hostOf(url)) : hostOf(url);
    byUrl.set(url, { url, title: chunk.title, tier: sourceTier(host, row, hints), order: byUrl.size });
  }

  const kept = [...byUrl.values()]
    .sort((a, b) => SOURCE_TIERS.indexOf(a.tier) - SOURCE_TIERS.indexOf(b.tier) || a.order - b.order)
    .slice(0, MAX_SOURCES);
  const numberOf = new Map(kept.map((s, i) => [s.url, i + 1]));

  // Every kept source is cited by some claim (see citedChunks), so the
  // numbers S1..Sn line up with the returned `sources`.
  const refsByText = new Map<string, Set<number>>();
  for (const support of supportsWithText(response)) {
    const refs = support.chunks
      .map((i) => numberOf.get(urlOfChunk.get(i) ?? ""))
      .filter((n): n is number => n !== undefined);
    if (refs.length === 0) continue;
    const set = refsByText.get(support.text) ?? new Set<number>();
    for (const n of refs) set.add(n);
    refsByText.set(support.text, set);
  }
  if (refsByText.size === 0) return { notes: "", sources: [], claims: [] };

  const claims: Claim[] = [...refsByText].map(([text, refs]) => ({
    text,
    sources: [...refs].sort((a, b) => a - b),
  }));
  const sources = kept.map(({ url, title, tier }) => ({ url, title, tier }));
  return { notes: renderNotes(sources, claims), sources, claims };
}

const claimLine = (c: Claim) => `- ${c.text} [${c.sources.map((n) => `S${n}`).join(", ")}]`;

/**
 * The notes the extraction model reads: numbered sources with tiers, then
 * claims in two groups: text read from the pages themselves (quoted first),
 * and the search model's summary (the fallback).
 */
export function renderNotes(sources: TieredSource[], claims: Claim[]): string {
  if (claims.length === 0) return "";
  const page = claims.filter((c) => c.origin === "page");
  const search = claims.filter((c) => c.origin !== "page");
  return [
    "Sources:",
    ...sources.map((s, i) => `[S${i + 1}] ${s.tier}: ${s.title} (${s.url})`),
    ...(page.length > 0
      ? ["", "Page text (copied from the sources in brackets; quote these first):", ...page.map(claimLine)]
      : []),
    ...(search.length > 0
      ? ["", "Search summary (the search model's own words about the sources in brackets):", ...search.map(claimLine)]
      : []),
  ].join("\n");
}

/** Gemini 3+ bills grounding per executed search query. */
export function countSearchCalls(response: Grounded): number {
  return response.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
}

/**
 * Billing-relevant token counts. Thinking tokens are billed as output, and
 * tool-use prompt tokens (search results fed to the model) as input.
 */
export function searchUsage(response: Grounded): TokenUsage {
  const u = response.usageMetadata;
  return {
    inputTokens: (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0),
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
    cachedTokens: u?.cachedContentTokenCount ?? 0,
  };
}

/**
 * Grounding citations are Google redirect links; resolve each to the real
 * page URL (no body is downloaded). Falls back to the redirect link.
 */
export async function resolveUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchImpl(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    const location = res.headers.get("location");
    return location ? cleanUrl(new URL(location, url).toString()) : url;
  } catch {
    return url;
  }
}

/** One Gemini call with Google Search grounding: grounded notes plus ranked citations. */
export async function groundedSearch(
  prompt: string,
  row: RowInput,
  hints: TierHints = {},
): Promise<SearchResult> {
  const { model, response } = await withFallback("search", async (choice, retries) => {
    const { model, thinkingConfig } = genAIConfig(choice);
    const response = await getGenAI().models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig,
        // attempts includes the first request.
        httpOptions: { retryOptions: { attempts: 1 + retries } },
      },
    });
    return { model, response };
  });

  const uris = [...new Set([...citedChunks(response).values()].map((c) => c.uri))];
  const resolved = new Map(
    await Promise.all(uris.map(async (uri) => [uri, await resolveUrl(uri)] as const)),
  );
  return {
    ...groundedNotes(response, resolved, row, hints),
    usage: searchUsage(response),
    searchCalls: countSearchCalls(response),
    model,
  };
}

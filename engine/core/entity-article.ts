import { z } from "zod";
import type { JobConfig } from "@engine/contracts/job-config";
import { siteOf } from "./anchors";
import type { RowInput } from "./build-prompt";
import { fetchPage, type FetchLike } from "./page";
import type { Grounding } from "./search";
import { foldCase, hostOf, matchesHost } from "./source-tier";
import { titleMatchesKey } from "./wikidata";

/**
 * The Wikipedia article about this row's entity, for any kind of entity.
 * Whether it was cited by the search or looked up by name, it is accepted
 * only if it agrees with what the row already says:
 *   - when the entity's own site is known (the row's URL, or a cited source
 *     named after the key), the article must link to it: "Apple" the fruit
 *     doesn't link to apple.com;
 *   - otherwise it must mention the row's own values (an author, a country,
 *     a developer, a park): two of them, or the only one the row has.
 * A cited article is also accepted when the row says nothing to check
 * against; a looked-up one never is.
 */

export type EntityArticle = { lang: string; title: string; url: string; html: string };

const MAX_LOOKUPS = 3;
const MAX_FACT_CHARS = 80;

const SearchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })) }).optional(),
});

/** The row's own values worth checking a page against (not the key, not tiny or huge ones). */
export function rowFacts(config: Pick<JobConfig, "keyColumn">, row: RowInput): string[] {
  return Object.entries(row.input)
    .filter(([col]) => col !== config.keyColumn)
    .map(([, v]) => v.trim())
    .filter((v) => v.length >= 3 && v.length <= MAX_FACT_CHARS && !hostOf(v) && !/^\d{1,3}$/.test(v));
}

/** Sites known to be the entity's own: URLs in the row, and cited sources named after the key. */
export function ownHosts(row: RowInput, grounding: Grounding): string[] {
  const hosts = new Set<string>();
  for (const v of Object.values(row.input)) {
    const host = hostOf(v);
    if (host) hosts.add(host);
  }
  for (const s of grounding.sources) {
    const host = s.tier === "official" ? hostOf(s.url) : null;
    if (host) hosts.add(siteOf(host));
  }
  return [...hosts];
}

function textOf(html: string): string {
  return foldCase(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}

/** Whether a page agrees with the row (see the module comment). */
export function agreesWithRow(html: string, facts: string[], hosts: string[], cited: boolean): boolean {
  if (hosts.length > 0) {
    const linked = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => hostOf(m[1] ?? ""));
    return hosts.some((h) => linked.some((l) => l !== null && matchesHost(l, h)));
  }
  if (facts.length === 0) return cited;
  const text = textOf(html);
  const found = facts.filter((f) => text.includes(foldCase(f))).length;
  return found >= Math.min(2, facts.length);
}

type Candidate = { lang: string; title: string; cited: boolean };

function citedArticles(grounding: Grounding, key: string): Candidate[] {
  return grounding.sources
    .flatMap((s): Candidate[] => {
      const host = hostOf(s.url);
      if (!host || !matchesHost(host, "wikipedia.org")) return [];
      try {
        const path = new URL(s.url).pathname;
        if (!path.startsWith("/wiki/")) return [];
        const title = decodeURIComponent(path.slice(6)).replace(/_/g, " ");
        return title.includes(":") || !titleMatchesKey(key, title) ? [] : [{ lang: host.split(".")[0] ?? "en", title, cited: true }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Number(b.lang === "en") - Number(a.lang === "en") || a.title.length - b.title.length);
}

async function searchTitles(query: string, fetchImpl: FetchLike): Promise<string[]> {
  const api = new URL("https://en.wikipedia.org/w/api.php");
  api.search = new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: "5", format: "json" }).toString();
  const page = await fetchPage(api.toString(), fetchImpl);
  if (!page) return [];
  try {
    return SearchSchema.parse(JSON.parse(page.body)).query?.search.map((r) => r.title) ?? [];
  } catch {
    return [];
  }
}

const articleUrl = (c: Candidate) => `https://${c.lang}.wikipedia.org/wiki/${encodeURIComponent(c.title.replace(/ /g, "_"))}`;

/** The article about the row's entity, or null if none agrees with the row. Never throws. */
export async function findArticle(
  grounding: Grounding,
  config: Pick<JobConfig, "keyColumn">,
  row: RowInput,
  fetchImpl: FetchLike = fetch,
): Promise<EntityArticle | null> {
  try {
    const facts = rowFacts(config, row);
    const hosts = ownHosts(row, grounding);
    let candidates = citedArticles(grounding, row.key);
    // Look one up only when there is something to check it against.
    if (candidates.length === 0 && (hosts.length > 0 || facts.length > 0)) {
      const titles = await searchTitles([row.key, ...facts.slice(0, 1)].join(" "), fetchImpl);
      candidates = titles.filter((t) => titleMatchesKey(row.key, t)).map((title) => ({ lang: "en", title, cited: false }));
    }
    for (const c of candidates.slice(0, MAX_LOOKUPS)) {
      const url = articleUrl(c);
      const page = await fetchPage(url, fetchImpl);
      if (page && agreesWithRow(page.body, facts, hosts, c.cited)) {
        return { lang: c.lang, title: c.title, url: page.url || url, html: page.body };
      }
    }
    return null;
  } catch {
    return null;
  }
}

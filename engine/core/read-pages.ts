import type { FieldDef, JobConfig } from "@engine/contracts/job-config";
import { MAX_PAGE_CHARS, MAX_PAGES_PER_ROW } from "@engine/config/limits";
import type { RowInput } from "./build-prompt";
import type { EntityArticle } from "./entity-article";
import { fetchPage, type FetchLike, type Page } from "./page";
import { bodyPassages, infoboxRows } from "./page-text";
import { pdfPassages } from "./pdf-text";
import { rowSites } from "./scope";
import { renderNotes, type Claim, type Grounding, type TieredSource } from "./search";
import { foldCase, hostOf, matchesHost, SOURCE_TIERS } from "./source-tier";

/**
 * Reads the row's best sources ourselves and adds their own text as page
 * claims (origin "page"), so extraction can quote what a page actually says
 * instead of the search model's summary of it. The search finds the pages;
 * its claims stay as the fallback for pages we can't read (blocked, PDF,
 * rendered by script).
 */

const READ_TIERS = new Set<TieredSource["tier"]>(["official", "authority", "reference"]);
/** The opening passages are always kept: they usually say what the entity is. */
const LEAD_PASSAGES = 3;
const MIN_PASSAGE_BUDGET = 3000;
/** PDFs are slow to fetch and parse; one per row is enough for a report or spec sheet. */
const MAX_PDFS_PER_ROW = 1;
const TIER_ORDER: readonly string[] = SOURCE_TIERS;

// Words in field definitions that don't say what to look for.
const STOP_WORDS = new Set([
  "that", "this", "with", "from", "their", "there", "what", "which", "when", "where", "only", "than",
  "into", "each", "also", "other", "such", "more", "most", "none", "null", "field", "value", "values",
  "name", "names", "official", "current", "currently", "latest", "full", "main", "primary", "does",
  "about", "known", "number", "list", "short", "item", "items", "given", "e.g.", "exclude", "excluding",
  "include", "including", "true", "false", "whether",
]);

const words = (text: string) => foldCase(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
/** A crude stem, so "employees" meets "employs" and "founded" meets "founders". */
const stem = (word: string) => word.slice(0, 5);

/** Stems of the words in the fields' names and definitions. */
export function fieldTerms(fields: FieldDef[]): Set<string> {
  const text = fields.map((f) => `${f.name.replace(/_/g, " ")} ${f.description}`).join(" ");
  return new Set(words(text).filter((w) => !STOP_WORDS.has(w)).map(stem));
}

/** How many of the field terms a passage mentions. */
function relevance(passage: string, terms: Set<string>): number {
  const stems = new Set(words(passage).map(stem));
  let score = 0;
  for (const t of terms) if (stems.has(t)) score += 1;
  return score;
}

/**
 * The opening passages plus the most relevant others, within `budget`
 * characters, back in page order.
 */
export function selectPassages(passages: string[], terms: Set<string>, budget: number): string[] {
  const ranked = passages
    .map((text, i) => ({ text, i, score: i < LEAD_PASSAGES ? Infinity : relevance(text, terms) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const kept: typeof ranked = [];
  let used = 0;
  for (const p of ranked) {
    if (used + p.text.length > budget) continue;
    kept.push(p);
    used += p.text.length;
  }
  return kept.sort((a, b) => a.i - b.i).map((p) => p.text);
}

/**
 * Which sources to read (1-based numbers), best first: the entity's own
 * pages, then the source plan's readable sites for this row (registries
 * first), then other authority and reference pages. Wikipedia is read only
 * through the checked article (see findArticle), Wikidata is used as
 * structured data, plan sites known to block us are skipped, and at most
 * one PDF is read.
 */
export function choosePages(sources: TieredSource[], config: JobConfig, row: RowInput, limit = MAX_PAGES_PER_ROW): number[] {
  const plan = rowSites(config, row);
  const planRank = (host: string) => {
    const site = plan.find((p) => matchesHost(host, p.host));
    if (!site) return null;
    return site.status === "search_only" ? -1 : site.role === "registry" ? 0 : 1;
  };
  const ranked = sources.flatMap((s, i) => {
    const host = hostOf(s.url);
    if (!host || matchesHost(host, "wikidata.org") || matchesHost(host, "wikipedia.org")) return [];
    const inPlan = planRank(host);
    if (inPlan === -1) return [];
    const rank = s.tier === "official" ? 0 : inPlan !== null ? 1 + inPlan : READ_TIERS.has(s.tier) ? 3 + TIER_ORDER.indexOf(s.tier) : null;
    return rank === null ? [] : [{ n: i + 1, rank, pdf: /\.pdf(?:$|[?#])/i.test(s.url) }];
  });
  ranked.sort((a, b) => a.rank - b.rank || a.n - b.n);
  const out: number[] = [];
  let pdfs = 0;
  for (const p of ranked) {
    if (p.pdf && pdfs >= MAX_PDFS_PER_ROW) continue;
    if (p.pdf) pdfs += 1;
    out.push(p.n);
    if (out.length >= limit) break;
  }
  return out;
}

/** The passages of one HTML page worth showing the extraction model. */
export function pagePassages(html: string, terms: Set<string>): string[] {
  const rows = infoboxRows(html);
  const used = rows.reduce((n, r) => n + r.length, 0);
  return [...rows, ...selectPassages(bodyPassages(html), terms, Math.max(MIN_PASSAGE_BUDGET, MAX_PAGE_CHARS - used))];
}

async function passagesOf(page: Page, terms: Set<string>): Promise<string[]> {
  if (page.pdf) return selectPassages(await pdfPassages(page.pdf), terms, MAX_PAGE_CHARS);
  return isHtml(page.body) ? pagePassages(page.body, terms) : [];
}

const isHtml = (body: string) => /<(html|body|div|p)\b/i.test(body.slice(0, 20_000));

/**
 * The grounding plus page claims from the row's article (already fetched)
 * and the chosen sources. Pages that fail to load are skipped. Never fails
 * the row: on any error the grounding comes back unchanged.
 */
export async function readPages(
  grounding: Grounding,
  config: JobConfig,
  row: RowInput,
  { article = null, fetchImpl = fetch }: { article?: EntityArticle | null; fetchImpl?: FetchLike } = {},
): Promise<Grounding> {
  try {
    let sources = grounding.sources;
    const pages: { n: number; page: Page }[] = [];
    if (article) {
      let n = sources.findIndex((s) => s.url === article.url) + 1;
      if (n === 0) {
        sources = [...sources, { url: article.url, title: `Wikipedia: ${article.title}`, tier: "reference" }];
        n = sources.length;
      }
      pages.push({ n, page: { url: article.url, body: article.html } });
    }
    const chosen = choosePages(sources, config, row, MAX_PAGES_PER_ROW - pages.length);
    const fetched = await Promise.all(
      chosen.map(async (n) => ({ n, page: await fetchPage(sources[n - 1]?.url ?? "", fetchImpl) })),
    );
    for (const f of fetched) if (f.page) pages.push({ n: f.n, page: f.page });
    if (pages.length === 0) return grounding;

    const terms = fieldTerms(config.fields);
    const byText = new Map<string, Claim>(grounding.claims.map((c) => [c.text, c]));
    for (const { n, page } of pages) {
      for (const text of await passagesOf(page, terms)) {
        const known = byText.get(text);
        byText.set(
          text,
          known
            ? { ...known, sources: [...new Set([...known.sources, n])].sort((a, b) => a - b), origin: "page" }
            : { text, sources: [n], origin: "page" },
        );
      }
    }
    const claims = [...byText.values()];
    if (claims.length === grounding.claims.length && sources === grounding.sources) return grounding;
    return { ...grounding, sources, claims, notes: renderNotes(sources, claims) };
  } catch {
    return grounding;
  }
}

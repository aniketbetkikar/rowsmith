import { z } from "zod";
import { fetchPage, type FetchLike } from "./page";
import { foldCase, hostOf, matchesHost } from "./source-tier";

/**
 * Wikidata statements that are links (official site, social profiles), for
 * the entity of the row's Wikipedia article. That article was checked
 * against the row first (see findArticle), which keeps us on the right
 * entity: "Apple" the company, not the fruit.
 */

/** `region` names the version when only a country/region page was listed. */
export type WikidataLink = { label: string; url: string; region?: string };
export type WikidataLinks = { qid: string; pageUrl: string; links: WikidataLink[] };

const LINK_PROPS: { prop: string; label: string; url: (value: string) => string }[] = [
  { prop: "P856", label: "official website", url: (v) => v },
  { prop: "P4264", label: "LinkedIn page", url: (id) => `https://www.linkedin.com/company/${id}` },
  { prop: "P2002", label: "X (Twitter) account", url: (id) => `https://x.com/${id}` },
  { prop: "P2003", label: "Instagram account", url: (id) => `https://www.instagram.com/${id}` },
  { prop: "P2013", label: "Facebook page", url: (id) => `https://www.facebook.com/${id}` },
  { prop: "P2397", label: "YouTube channel", url: (id) => `https://www.youtube.com/channel/${id}` },
];
/** Qualifier "end time": the statement is no longer current. */
const END_TIME = "P582";
/** Qualifier "language of work", e.g. a regional site; English is Q1860. */
const LANGUAGE = "P407";
/** Qualifier "applies to jurisdiction": a country's version (toyota.de). */
const JURISDICTION = "P1001";
const ENGLISH = "Q1860";

/**
 * When only country/region versions are listed (Toyota's dealer pages), the
 * default: the United States, then the EU / Europe.
 */
const DEFAULT_REGIONS: { name: string; ids: string[] }[] = [
  { name: "the United States", ids: ["Q30"] },
  { name: "Europe", ids: ["Q458", "Q46"] },
];

const QualifierIdsSchema = z.array(
  z.object({ datavalue: z.object({ value: z.object({ id: z.string() }) }).optional() }),
);

function qualifierIds(s: Statement, prop: string): string[] {
  const values = QualifierIdsSchema.safeParse(s.qualifiers?.[prop] ?? []).data ?? [];
  return values.flatMap((v) => (v.datavalue ? [v.datavalue.value.id] : []));
}

const PagePropsSchema = z.object({
  query: z
    .object({
      pages: z.record(
        z.string(),
        z.object({
          pageprops: z
            .object({ wikibase_item: z.string().optional(), disambiguation: z.string().optional() })
            .optional(),
        }),
      ),
    })
    .optional(),
});

const StatementSchema = z.object({
  mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }),
  rank: z.string().optional(),
  qualifiers: z.record(z.string(), z.unknown()).optional(),
});

const EntityDataSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({ claims: z.record(z.string(), z.array(StatementSchema)).optional() }),
  ),
});

type Statement = z.infer<typeof StatementSchema>;

const tokens = (value: string) => foldCase(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * An article title is about the key if every word of the key starts a word of
 * the title, ignoring a "(disambiguator)": "Apple" ~ "Apple Inc.",
 * "Teva Pharmaceutical" ~ "Teva Pharmaceuticals", but not "Novo Nordisk" ~
 * "Novo (company)" or "Nestlé" ~ "Laurent Freixe".
 */
export function titleMatchesKey(key: string, title: string): boolean {
  const titleTokens = tokens(title.replace(/\([^)]*\)/g, " "));
  const keyTokens = tokens(key);
  return keyTokens.length > 0 && keyTokens.every((k) => titleTokens.some((t) => t.startsWith(k)));
}

export type Article = { lang: string; title: string };

/** The cited Wikipedia article about the key (shortest matching title), if any. */
export function articleFor(key: string, urls: string[]): Article | null {
  const articles = urls.flatMap((raw): Article[] => {
    const host = hostOf(raw);
    if (!host || !matchesHost(host, "wikipedia.org")) return [];
    try {
      const path = new URL(raw).pathname;
      if (!path.startsWith("/wiki/")) return [];
      const title = decodeURIComponent(path.slice("/wiki/".length)).replace(/_/g, " ");
      const lang = host.split(".")[0] ?? "en";
      return title && !title.includes(":") ? [{ lang, title }] : [];
    } catch {
      return [];
    }
  });
  return (
    articles
      .filter((a) => titleMatchesKey(key, a.title))
      .sort((a, b) => Number(b.lang === "en") - Number(a.lang === "en") || a.title.length - b.title.length)[0] ??
    null
  );
}

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const page = await fetchPage(url, fetchImpl, { maxBytes: 12_000_000 });
  if (!page) return null;
  try {
    return JSON.parse(page.body) as unknown;
  } catch {
    return null;
  }
}

/** A statement for no particular country and for no language or English. */
function forAnyone(s: Statement): boolean {
  if (s.qualifiers?.[JURISDICTION]) return false;
  const ids = qualifierIds(s, LANGUAGE);
  return ids.length === 0 || ids.includes(ENGLISH);
}

/** One answer from several values: the only one, or the shortest if all are on one site. */
function single(statements: Statement[]): string | null {
  const values = statements
    .map((s) => s.mainsnak.datavalue?.value)
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim());
  if (values.length === 1) return values[0] ?? null;
  // Several addresses on one site (global.toyota, global.toyota/en/) are one answer.
  const hosts = new Set(values.map((v) => hostOf(v) ?? v));
  return hosts.size === 1 ? ([...values].sort((a, b) => a.length - b.length)[0] ?? null) : null;
}

/**
 * The value Wikidata gives as the main one, or null. Deprecated and ended
 * statements are dropped, then the first of these that gives one answer:
 *   1. the preferred statement (Toyota's site is global.toyota, though tagged Japanese);
 *   2. the general one: no country, no language or English (not toyota.de, apple.com/de/);
 *   3. the US version, then the EU / Europe one, named as such.
 * Otherwise Wikidata doesn't say which is the entity's, so none is used.
 */
function mainValue(statements: Statement[]): { value: string; region?: string } | null {
  const live = statements.filter((s) => s.rank !== "deprecated" && !s.qualifiers?.[END_TIME]);
  const preferred = single(live.filter((s) => s.rank === "preferred"));
  if (preferred) return { value: preferred };
  const general = single(live.filter(forAnyone));
  if (general) return { value: general };
  for (const region of DEFAULT_REGIONS) {
    const value = single(live.filter((s) => qualifierIds(s, JURISDICTION).some((id) => region.ids.includes(id))));
    if (value) return { value, region: region.name };
  }
  return null;
}

export function linksFromClaims(claims: Record<string, Statement[]>): WikidataLink[] {
  return LINK_PROPS.flatMap(({ prop, label, url }) => {
    const main = mainValue(claims[prop] ?? []);
    if (!main) return [];
    return [{ label, url: url(main.value), ...(main.region ? { region: main.region } : {}) }];
  });
}

/** Link statements for the article's entity (see findArticle), or null if there is none. */
export async function wikidataLinks(
  article: Article | null,
  fetchImpl: FetchLike = fetch,
): Promise<WikidataLinks | null> {
  if (!article) return null;

  const api = new URL(`https://${article.lang}.wikipedia.org/w/api.php`);
  api.search = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "pageprops",
    ppprop: "wikibase_item|disambiguation",
    redirects: "1",
    titles: article.title,
  }).toString();
  const props = PagePropsSchema.safeParse(await fetchJson(api.toString(), fetchImpl)).data;
  const page = Object.values(props?.query?.pages ?? {})[0];
  const qid = page?.pageprops?.wikibase_item;
  if (!qid || page.pageprops?.disambiguation !== undefined || !/^Q\d+$/.test(qid)) return null;

  const data = EntityDataSchema.safeParse(
    await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, fetchImpl),
  ).data;
  const entity = data ? Object.values(data.entities)[0] : undefined;
  if (!entity) return null;
  return { qid, pageUrl: `https://www.wikidata.org/wiki/${qid}`, links: linksFromClaims(entity.claims ?? {}) };
}

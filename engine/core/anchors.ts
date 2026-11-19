import type { JobConfig } from "@engine/contracts/job-config";
import type { RowInput } from "./build-prompt";
import { fetchPage, pageLinks, pageNames, type FetchLike, type Page } from "./page";
import { mergeGroundings } from "./research";
import { renderNotes, type Claim, type Grounding, type TieredSource } from "./search";
import { entityHosts, foldCase, hostOf, matchesHost, sourceTier, type TierHints } from "./source-tier";
import { tierHints } from "./scope";
import { wikidataLinks, type Article, type WikidataLinks } from "./wikidata";

/**
 * Anchors: facts a search can't state as a sentence, proven by reading pages
 * ourselves. Which site is the entity's own (confirmed by fetching it), the
 * profiles that site links to, and Wikidata's link statements. They become
 * page claims (origin "page") next to the search's claims, so a URL field is
 * filled from something we read, not from the search model's wording.
 */

const MAX_CANDIDATES = 3;
const MAX_PER_PROFILE = 2;

type Profile = { label: string; hosts: string[]; path: RegExp };

/** Profile pages any kind of entity may link to. */
const PROFILES: Profile[] = [
  { label: "LinkedIn page", hosts: ["linkedin.com"], path: /^\/(company|school|showcase)\/[^/?#]+/i },
  {
    label: "X (Twitter) account",
    hosts: ["x.com", "twitter.com"],
    path: /^\/(?!(?:intent|share|home|search|hashtag|i)(?:\/|$))[A-Za-z0-9_]{1,15}\/?$/,
  },
  {
    label: "Instagram account",
    hosts: ["instagram.com"],
    path: /^\/(?!(?:p|reel|reels|explore|stories)(?:\/|$))[A-Za-z0-9_.]{1,30}\/?$/,
  },
  {
    label: "Facebook page",
    hosts: ["facebook.com"],
    path: /^\/(?!(?:sharer|sharer\.php|share|dialog|plugins|tr|login)(?:\/|$))[A-Za-z0-9.-]{2,}\/?$/,
  },
  { label: "YouTube channel", hosts: ["youtube.com"], path: /^\/(@[^/]+|c\/[^/]+|channel\/[^/]+|user\/[^/]+)\/?$/ },
  { label: "TikTok account", hosts: ["tiktok.com"], path: /^\/@[^/]+\/?$/ },
];

const PROFILE_HOSTS = PROFILES.flatMap((p) => p.hosts);

// Words that don't tell one entity's name from another's.
const GENERIC = new Set([
  "the", "and", "inc", "incorporated", "corp", "corporation", "co", "company", "group", "holding",
  "holdings", "ltd", "limited", "llc", "plc", "sa", "ag", "se", "nv", "bv", "spa", "gmbh", "ab",
  "asa", "oyj", "pvt", "private", "international", "global", "official",
]);

const tokens = (value: string) => foldCase(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const compact = (value: string) => tokens(value).join("");

/**
 * A page name is about the key if it contains the whole key ("Red Bull" in
 * "Red Bull Energy Drink") or one of its distinctive words ("InBev" in
 * "AB InBev" for "Anheuser-Busch InBev").
 */
export function namesMatch(key: string, name: string): boolean {
  const k = compact(key);
  if (k.length >= 3 && compact(name).includes(k)) return true;
  const nameTokens = new Set(tokens(name));
  return tokens(key).some((t) => t.length >= 3 && !GENERIC.has(t) && nameTokens.has(t));
}

/** A profile URL on a known platform, as one canonical link, or null. */
export function profileOf(raw: string): { label: string; url: string } | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|[a-z]{2})\./, "");
    for (const profile of PROFILES) {
      const base = profile.hosts.find((h) => host === h);
      const path = base ? profile.path.exec(url.pathname)?.[0] : undefined;
      if (!base || !path) continue;
      // X has one canonical host; the other platforms use www.
      const canonical = profile.hosts[0] === "x.com" ? "x.com" : `www.${base}`;
      return { label: profile.label, url: `https://${canonical}${path.replace(/\/$/, "")}` };
    }
  } catch {
    // not a URL
  }
  return null;
}

/**
 * The site a host belongs to: "investors.spotify.com" → "spotify.com",
 * "shop.unilever.co.uk" → "unilever.co.uk" (a short second level under a
 * 2-letter country code counts as part of the suffix).
 */
export function siteOf(host: string): string {
  const labels = host.split(".");
  const tld = labels.at(-1) ?? "";
  const sld = labels.at(-2) ?? "";
  const keep = tld.length === 2 && sld.length <= 3 && labels.length > 2 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

type Via = "row" | "wikidata" | "source" | "claim";
type Candidate = { host: string; via: Via };

const SITE_WORDS = /\b(website|homepage|home page|site|url|web address)\b/i;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s)\]"'<>,]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

/**
 * Hosts that may be the entity's own site, best evidence first: the row's
 * own URL, Wikidata's official website, sources already named after the key,
 * then sites a claim names as the website.
 */
export function officialCandidates(
  row: RowInput,
  grounding: Grounding,
  wikidata: WikidataLinks | null,
  hints: TierHints,
): Candidate[] {
  const out: Candidate[] = [];
  const add = (host: string | null, via: Via) => {
    if (!host || out.some((c) => c.host === host)) return;
    if (PROFILE_HOSTS.some((p) => matchesHost(host, p))) return;
    const tier = sourceTier(host, row, hints);
    if (via === "claim" && tier !== "official" && tier !== "web") return;
    out.push({ host, via });
  };
  for (const host of entityHosts(row)) add(host, "row");
  for (const link of wikidata?.links ?? []) {
    // A country version (toyota.com for the US) is not the entity's own site.
    if (link.label === "official website" && !link.region) add(hostOf(link.url), "wikidata");
  }
  for (const s of grounding.sources) if (s.tier === "official") {
    const host = hostOf(s.url);
    add(host && siteOf(host), "source");
  }
  for (const claim of grounding.claims) {
    if (!SITE_WORDS.test(claim.text)) continue;
    for (const m of claim.text.match(URL_IN_TEXT) ?? []) {
      const host = hostOf(m.replace(/[.;:]+$/, ""));
      add(host && siteOf(host), "claim");
    }
  }
  return out.slice(0, MAX_CANDIDATES);
}

type Official = { origin: string; host: string; page: Page | null; via: Via };

/**
 * The first candidate we can confirm: its homepage loads and names the key.
 * A homepage we can't read (blocked, down) still counts when the row or
 * Wikidata named it, or its domain is named after the key.
 */
async function confirmOfficial(
  row: RowInput,
  candidates: Candidate[],
  hints: TierHints,
  fetchImpl: FetchLike,
): Promise<Official | null> {
  for (const c of candidates) {
    const page = await fetchPage(`https://${c.host}/`, fetchImpl);
    const trusted = c.via === "row" || c.via === "wikidata";
    if (page) {
      const names = pageNames(page.body);
      if (trusted || names.some((n) => namesMatch(row.key, n))) {
        const origin = new URL(page.url).origin;
        return { origin, host: hostOf(origin) ?? c.host, page, via: c.via };
      }
      continue;
    }
    if (trusted || sourceTier(c.host, row, { trusted: hints.trusted }) === "official") {
      return { origin: `https://${c.host}`, host: c.host, page: null, via: c.via };
    }
  }
  return null;
}

/** The profile links on a page, at most a couple per platform. */
export function profileLinks(page: Page): { label: string; url: string }[] {
  const seen = new Map<string, string[]>();
  for (const link of pageLinks(page.body, page.url)) {
    const profile = profileOf(link);
    if (!profile) continue;
    const urls = seen.get(profile.label) ?? [];
    if (urls.length < MAX_PER_PROFILE && !urls.includes(profile.url)) urls.push(profile.url);
    seen.set(profile.label, urls);
  }
  return [...seen].flatMap(([label, urls]) => urls.map((url) => ({ label, url })));
}

function anchorGrounding(row: RowInput, official: Official | null, wikidata: WikidataLinks | null): Grounding {
  const sources: TieredSource[] = [];
  const claims: Claim[] = [];
  const sourceNumber = (source: TieredSource) => {
    const i = sources.findIndex((s) => s.url === source.url);
    if (i >= 0) return i + 1;
    sources.push(source);
    return sources.length;
  };

  // The entity's own site is the authority on its profiles: Wikidata's
  // value for a platform the site links to is left out.
  const linked = new Set(official?.page ? profileLinks(official.page).map((l) => l.label) : []);
  const wikidataLinks = (wikidata?.links ?? []).filter(
    (l) => !linked.has(l.label) && !(official?.page && l.label === "official website"),
  );
  if (wikidata && wikidataLinks.length > 0) {
    const n = sourceNumber({ url: wikidata.pageUrl, title: `Wikidata ${wikidata.qid}`, tier: "reference" });
    for (const link of wikidataLinks) {
      const scope = link.region ? ` for ${link.region}` : "";
      claims.push({ text: `Wikidata lists the ${link.label} of ${row.key}${scope} as ${link.url}.`, sources: [n], origin: "page" });
    }
  }
  // We only cite pages we read: an unread homepage is stated only through
  // Wikidata (above); it still re-ranks the search's sources from that site.
  if (official?.page) {
    const page = official.page;
    const n = sourceNumber({ url: page.url, title: pageNames(page.body)[0] ?? official.host, tier: "official" });
    claims.push({ text: `The official website of ${row.key} is ${official.origin}.`, sources: [n], origin: "page" });
    for (const link of profileLinks(page)) {
      claims.push({
        text: `The official website of ${row.key} (${official.origin}) links to its ${link.label}: ${link.url}.`,
        sources: [n],
        origin: "page",
      });
    }
  }
  return { notes: renderNotes(sources, claims), sources, claims };
}

/** Marks the search's sources on the confirmed official site as official. */
function retier(grounding: Grounding, officialHost: string): Grounding {
  const sources = grounding.sources.map((s) => {
    const host = hostOf(s.url);
    return host && matchesHost(host, officialHost) ? { ...s, tier: "official" as const } : s;
  });
  return { ...grounding, sources };
}

/**
 * The search's grounding plus anchor claims, merged and re-ranked. Only runs
 * when the job has a URL field. Never fails the row: on any error the
 * grounding comes back unchanged.
 */
export async function addAnchors(
  grounding: Grounding,
  config: JobConfig,
  row: RowInput,
  { article = null, fetchImpl = fetch }: { article?: Article | null; fetchImpl?: FetchLike } = {},
): Promise<Grounding> {
  if (!config.fields.some((f) => f.type === "url") || grounding.sources.length === 0) return grounding;
  try {
    const hints: TierHints = tierHints(config, row);
    const wikidata = await wikidataLinks(article, fetchImpl);
    const official = await confirmOfficial(row, officialCandidates(row, grounding, wikidata, hints), hints, fetchImpl);
    const anchors = anchorGrounding(row, official, wikidata);
    const base = official ? retier(grounding, official.host) : grounding;
    return anchors.claims.length > 0 ? mergeGroundings([base, anchors]) : mergeGroundings([base]);
  } catch {
    return grounding;
  }
}

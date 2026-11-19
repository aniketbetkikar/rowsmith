import type { RowInput } from "./build-prompt";

/**
 * How much a source can be trusted, best first. Domain-agnostic:
 *   official   the entity's own site (a URL in the row, a confirmed official
 *              site, or a domain named after the key)
 *   authority  government, academic, military and international bodies
 *   reference  sites widely accepted for these entities: the job's trusted
 *              sites (e.g. an exchange, a listing platform) plus Wikipedia/Wikidata
 *   web        everything else (press, other reference works, blogs)
 *   community  forums, social and user-generated sites
 */
export const SOURCE_TIERS = ["official", "authority", "reference", "web", "community"] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

/** Reference works trusted for any kind of entity. */
export const DEFAULT_REFERENCE_HOSTS = ["wikipedia.org", "wikidata.org"];

/**
 * What a job and row know beyond the host: the source plan's registries
 * (ranked as authority) and other sites (reference), and confirmed official hosts.
 */
export type TierHints = {
  authority?: readonly string[];
  trusted?: readonly string[];
  official?: readonly string[];
};

const AUTHORITY_TLDS = new Set(["gov", "edu", "mil", "int"]);
// Second-level labels used for government/academic sites under a 2-letter ccTLD,
// e.g. gov.in, ac.uk, gob.mx, gouv.fr, govt.nz.
const AUTHORITY_SLDS = new Set(["gov", "gob", "gouv", "govt", "go", "edu", "ac", "mil"]);
const AUTHORITY_HOSTS = ["europa.eu", "un.org"];
const COMMUNITY_HOSTS = [
  "reddit.com",
  "quora.com",
  "medium.com",
  "substack.com",
  "scribd.com",
  "slideshare.net",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "pinterest.com",
  "fandom.com",
  "blogspot.com",
  "wordpress.com",
  "tumblr.com",
];

const DOMAIN_LIKE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/** Lowercase host without "www.", or null if the value isn't a URL/domain. */
export function hostOf(value: string): string | null {
  const trimmed = value.trim();
  if (!DOMAIN_LIKE.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function matchesHost(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

/** Lowercase, accents removed ("Nestlé" → "nestle"). */
export function foldCase(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

const compact = (value: string) => foldCase(value).replace(/[^\p{L}\p{N}]/gu, "");

/** Hosts of any URL or bare domain in the row's own columns (e.g. a website column). */
export function entityHosts(row: RowInput): string[] {
  return Object.values(row.input)
    .map(hostOf)
    .filter((host): host is string => host !== null);
}

export function sourceTier(host: string | null, row: RowInput, hints: TierHints = {}): SourceTier {
  if (!host) return "web";
  const labels = host.split(".");
  const key = compact(row.key);
  if (
    [...entityHosts(row), ...(hints.official ?? [])].some((base) => matchesHost(host, base)) ||
    (key.length >= 4 && labels.slice(0, -1).includes(key))
  ) {
    return "official";
  }
  const tld = labels.at(-1) ?? "";
  const sld = labels.at(-2) ?? "";
  if (
    AUTHORITY_TLDS.has(tld) ||
    (labels.length > 2 && tld.length === 2 && AUTHORITY_SLDS.has(sld)) ||
    [...AUTHORITY_HOSTS, ...(hints.authority ?? [])].some((base) => matchesHost(host, base))
  ) {
    return "authority";
  }
  if ([...(hints.trusted ?? []), ...DEFAULT_REFERENCE_HOSTS].some((base) => matchesHost(host, base))) {
    return "reference";
  }
  if (COMMUNITY_HOSTS.some((base) => matchesHost(host, base))) return "community";
  return "web";
}

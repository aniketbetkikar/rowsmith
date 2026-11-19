import { z } from "zod";
import type { FieldDef } from "@engine/contracts/job-config";
import type { BlankReason, CellEvidence, Evidence, Rejected, Source } from "@engine/contracts/row-result";
import type { RowOutput } from "./build-schema";
import type { Claim } from "./search";
import { hostOf } from "./source-tier";

// Shapes of buildEvidenceSchema()'s output (already validated per field type).
const ScalarCellSchema = z.object({ value: z.unknown(), quotes: z.array(z.string()) });
const ListCellSchema = z.object({
  items: z.array(z.object({ value: z.string(), quotes: z.array(z.string()) })),
});

/** Joins a value's quotes into the one stored quote (each part is a verbatim claim). */
export const QUOTE_JOIN = " … ";

/** A quote shorter than this could match almost any claim. */
export const MIN_QUOTE_CHARS = 8;

/** `rejected`: values our checks dropped, with their quotes (for debugging). */
export type Checked = { output: RowOutput; evidence: Evidence; rejected?: Rejected };

/** Adds a dropped value to `rejected` (mutates it). */
export function addRejected(rejected: Rejected, field: string, value: unknown, quotes: string[], reason: BlankReason): void {
  (rejected[field] ??= []).push({ value, quotes, reason });
}

/** Case, spacing, markdown, quote marks, dashes and digit grouping (383,853 = 383853) don't matter. */
export function normalizeQuote(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[s\d+(?:,\s*s\d+)*\]/g, " ")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[*_`#]/g, "")
    .replace(/(\d)[,' \u00a0\u202f](?=\d{3}(?!\d))/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'\s]+|["'.,;:\s]+$/g, "");
}

/** The claim a quote was copied from, or null if it isn't in any claim. */
export function findClaim(quote: string, claims: Claim[]): Claim | null {
  const q = normalizeQuote(quote);
  if (q.length < MIN_QUOTE_CHARS) return null;
  return claims.find((c) => normalizeQuote(c.text).includes(q)) ?? null;
}

const digits = (value: string) => value.replace(/[\s,_]/g, "");

/** "https://www.LinkedIn.com/company/apple/" → "linkedin.com/company/apple". */
export function urlKey(value: string): string | null {
  const host = hostOf(value);
  if (!host) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    return `${host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Cheap checks that the quote states the value itself. A year must appear in
 * the quote and a number field's quote must contain a number. A URL must be
 * one of the claim's sources (or a page above it, e.g. the site's homepage
 * for a page on that site), or, for a claim built from a page we read
 * (`fromPage`), appear in the quote in full. A URL that only appears in the
 * search model's own wording proves nothing: the model may have written it
 * from memory. Meaning is left to the verify pass.
 */
export function valueInQuote(
  field: FieldDef,
  value: unknown,
  quote: string,
  claimSources: Source[],
  fromPage = false,
): boolean {
  switch (field.type) {
    case "year":
      return typeof value === "number" && digits(normalizeQuote(quote)).includes(String(value));
    case "number":
      // "1.2 million" can state 1200000, so only require a number in the quote.
      return typeof value === "number" && /\d/.test(quote);
    case "url": {
      const key = typeof value === "string" ? urlKey(value) : null;
      if (!key) return false;
      if (fromPage && normalizeQuote(quote).replace(/https?:\/\/(www\.)?/g, "").includes(normalizeQuote(key))) return true;
      return claimSources.some((s) => {
        const source = urlKey(s.url);
        return source === key || (source?.startsWith(`${key}/`) ?? false);
      });
    }
    default:
      return true;
  }
}

function blank(reason: BlankReason): CellEvidence {
  return { quotes: [], blank: reason };
}

/**
 * The value's quotes that are copied from a grounded claim, joined into one
 * quote with every claim's sources. Quotes found in no claim are dropped
 * (verify then judges the value on the rest); null if none is left.
 */
function matchQuotes(
  quotes: string[],
  claims: Claim[],
): { text: string; sources: number[]; fromPage: boolean; origin: "page" | "search" } | null {
  const texts: string[] = [];
  const sources = new Set<number>();
  let fromPage = false;
  let fromSearch = false;
  for (const quote of quotes) {
    const claim = findClaim(quote, claims);
    const text = quote.trim();
    if (!claim || texts.includes(text)) continue;
    texts.push(text);
    for (const n of claim.sources) sources.add(n);
    if (claim.origin === "page") fromPage = true;
    else fromSearch = true;
  }
  if (texts.length === 0) return null;
  return {
    text: texts.join(QUOTE_JOIN),
    sources: [...sources].sort((a, b) => a - b),
    fromPage,
    origin: fromSearch ? "search" : "page",
  };
}

/**
 * Keeps only values with a quote copied from a grounded claim (and, for
 * numbers, years and URLs, whose quotes actually contain the value).
 * Anything else becomes null with the reason. Quote sources come from the
 * claims, never from the model.
 */
export function checkEvidence(
  fields: FieldDef[],
  raw: Record<string, unknown>,
  claims: Claim[],
  sources: Source[],
): Checked {
  const output: RowOutput = {};
  const evidence: Evidence = {};
  const rejected: Rejected = {};
  const sourcesOf = (numbers: number[]) =>
    numbers.flatMap((n) => (sources[n - 1] ? [sources[n - 1] as Source] : []));

  for (const field of fields) {
    output[field.name] = null;

    if (field.type === "list") {
      const items = ListCellSchema.safeParse(raw[field.name]).data?.items ?? [];
      const values: string[] = [];
      const quotes: CellEvidence["quotes"] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const quote = matchQuotes(item.quotes, claims);
        const key = normalizeQuote(item.value);
        if (!quote) addRejected(rejected, field.name, item.value, item.quotes, "unsupported");
        if (!quote || seen.has(key)) continue;
        seen.add(key);
        values.push(item.value.trim());
        quotes.push({ text: quote.text, sources: quote.sources, origin: quote.origin });
      }
      if (values.length > 0) {
        output[field.name] = values;
        evidence[field.name] = { quotes };
      } else {
        evidence[field.name] = blank(items.length > 0 ? "unsupported" : "not_found");
      }
      continue;
    }

    const cell = ScalarCellSchema.safeParse(raw[field.name]).data;
    if (!cell || cell.value === null || cell.value === undefined || cell.quotes.length === 0) {
      evidence[field.name] = blank("not_found");
      continue;
    }
    const quote = matchQuotes(cell.quotes, claims);
    if (!quote || !valueInQuote(field, cell.value, quote.text, sourcesOf(quote.sources), quote.fromPage)) {
      evidence[field.name] = blank("unsupported");
      addRejected(rejected, field.name, cell.value, cell.quotes, "unsupported");
      continue;
    }
    output[field.name] = cell.value;
    evidence[field.name] = { quotes: [{ text: quote.text, sources: quote.sources, origin: quote.origin }] };
  }
  return { output, evidence, rejected };
}

/** Every field null, with the same reason. */
export function allBlank(fields: FieldDef[], reason: BlankReason): Checked {
  return {
    output: Object.fromEntries(fields.map((f) => [f.name, null])),
    evidence: Object.fromEntries(fields.map((f) => [f.name, blank(reason)])),
    rejected: {},
  };
}

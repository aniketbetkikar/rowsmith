import type { FieldDef, JobConfig } from "@engine/contracts/job-config";
import { MAX_ROW_SOURCES, MAX_SEARCHES_PER_ROW, FIELDS_PER_SEARCH } from "@engine/config/limits";
import { SEARCH_RETRY, searchPrompt, type RowInput } from "./build-prompt";
import { renderNotes, type Claim, type Grounding, type TieredSource } from "./search";
import { SOURCE_TIERS } from "./source-tier";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Which fields each search covers. One search is enough for a few facts, but
 * open-ended lists need many grounded claims each, and a single search over
 * many lists returns too few. So:
 *   - with 2+ list fields, each list gets its own search;
 *   - the other fields share searches, FIELDS_PER_SEARCH at a time;
 *   - past MAX_SEARCHES_PER_ROW, groups are merged round-robin.
 * Fields keep their config order inside each group.
 */
export function planSearches(fields: FieldDef[]): FieldDef[][] {
  const lists = fields.filter((f) => f.type === "list");
  const splitLists = lists.length >= 2;
  const shared = splitLists ? fields.filter((f) => f.type !== "list") : fields;
  const groups = [...chunk(shared, FIELDS_PER_SEARCH), ...(splitLists ? lists.map((f) => [f]) : [])];
  if (groups.length <= MAX_SEARCHES_PER_ROW) return groups;

  const merged: FieldDef[][] = Array.from({ length: MAX_SEARCHES_PER_ROW }, () => []);
  groups.forEach((group, i) => merged[i % MAX_SEARCHES_PER_ROW]?.push(...group));
  const order = new Map(fields.map((f, i) => [f.name, i]));
  return merged.map((group) => group.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0)));
}

/**
 * Several searches' groundings as one: sources deduped by URL, re-ranked by
 * tier across all searches and capped at MAX_ROW_SOURCES; claims renumbered,
 * merged when identical, and dropped when all their sources were dropped.
 */
export function mergeGroundings(groundings: Grounding[]): Grounding {
  const byUrl = new Map<string, TieredSource & { order: number }>();
  for (const g of groundings) {
    for (const s of g.sources) {
      if (!byUrl.has(s.url)) byUrl.set(s.url, { ...s, order: byUrl.size });
    }
  }
  const kept = [...byUrl.values()]
    .sort((a, b) => SOURCE_TIERS.indexOf(a.tier) - SOURCE_TIERS.indexOf(b.tier) || a.order - b.order)
    .slice(0, MAX_ROW_SOURCES);
  const numberOf = new Map(kept.map((s, i) => [s.url, i + 1]));

  const refsByText = new Map<string, Set<number>>();
  const fromPage = new Set<string>();
  for (const g of groundings) {
    for (const claim of g.claims) {
      const refs = claim.sources
        .map((n) => numberOf.get(g.sources[n - 1]?.url ?? ""))
        .filter((n): n is number => n !== undefined);
      if (refs.length === 0) continue;
      const set = refsByText.get(claim.text) ?? new Set<number>();
      for (const n of refs) set.add(n);
      refsByText.set(claim.text, set);
      if (claim.origin === "page") fromPage.add(claim.text);
    }
  }

  const claims: Claim[] = [...refsByText].map(([text, refs]) => ({
    text,
    sources: [...refs].sort((a, b) => a - b),
    ...(fromPage.has(text) ? { origin: "page" as const } : {}),
  }));
  // Every source of a grounding is cited by one of its claims, and those
  // claims keep their kept sources, so S1..Sn all stay cited.
  const sources = kept.map(({ url, title, tier }) => ({ url, title, tier }));
  return { notes: renderNotes(sources, claims), sources, claims };
}

/**
 * Runs the planned searches in parallel (each retried once, insisting on a
 * search, if nothing came back grounded) and merges what they found.
 */
export async function research(
  config: JobConfig,
  row: RowInput,
  search: (prompt: string) => Promise<Grounding>,
): Promise<Grounding> {
  const results = await Promise.all(
    planSearches(config.fields).map(async (fields) => {
      const prompt = searchPrompt({ ...config, fields }, row);
      const first = await search(prompt);
      // The model sometimes answers well-known facts from memory without
      // searching, which leaves nothing grounded: ask once more, insisting.
      return first.claims.length > 0 ? first : search(`${prompt}\n\n${SEARCH_RETRY}`);
    }),
  );
  return results.length === 1 && results[0] ? results[0] : mergeGroundings(results);
}

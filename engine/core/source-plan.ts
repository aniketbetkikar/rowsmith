import { z } from "zod";
import { MAX_SITES, SiteSchema, type FieldDef, type PlanSite } from "@engine/contracts/job-config";
import { extractStructured } from "./extract";
import type { FetchLike } from "./page";
import { checkSites } from "./site-check";
import { foldCase, matchesHost } from "./source-tier";

/**
 * The source plan's sites, for any kind of entity: one structured call names
 * the sites that publish the fields' facts for the whole sheet and for each
 * scope value in the file (every country, platform, region… present, not
 * just the sample rows'), then each site is checked once (see site-check).
 */

const MAX_GLOBAL_SITES = 8;
const MAX_SITES_PER_SCOPE = 4;
/** Always used, so never part of the plan. */
const ALWAYS_USED = ["wikipedia.org", "wikidata.org"];

const DraftSitesSchema = z.object({
  sites: z.array(
    z.object({
      host: z.string().describe("Bare hostname, e.g. example.org"),
      role: z.enum(["registry", "reference", "listing"]),
      scope: z.string().nullable().describe("One of the listed scope values exactly, or null for every row"),
    }),
  ),
});
type DraftSites = z.infer<typeof DraftSitesSchema>;

export type PlanInput = {
  entityDescription: string;
  fields: FieldDef[];
  scopeColumn?: string;
  /** The scope column's values across the file, most common first. */
  scopes: { value: string; count: number }[];
};

function sitesPrompt(input: PlanInput): string {
  const fields = input.fields.map(
    (f) =>
      `- ${f.name}: ${f.description}${f.source ? ` (look it up on: ${f.source})` : ""}${f.roles?.length ? ` [${f.roles.join(" → ")}]` : ""}`,
  );
  const scope = input.scopeColumn
    ? [
        "",
        `Rows differ by "${input.scopeColumn}", which changes which sites are right. Its values in this file (rows per value):`,
        input.scopes.map((s) => `${s.value} (${s.count})`).join("; "),
      ]
    : [];
  return [
    `Rows: ${input.entityDescription}. Each row will be researched on the web to fill these fields:`,
    ...fields,
    ...scope,
    "",
    "Name the websites that publish these facts for these rows, by role:",
    "- registry: whoever regulates, certifies or officially records them;",
    "- reference: reference works for this subject;",
    "- listing: platforms where they are listed and kept current.",
    "",
    "Rules:",
    `- Sites for every row (scope null): at most ${MAX_GLOBAL_SITES}.`,
    input.scopeColumn
      ? `- Sites for one ${input.scopeColumn} value (scope set to that value, exactly as listed): at most ${MAX_SITES_PER_SCOPE} per value, only where that value has its own registry, reference or listing sites. Skip a value when it has none.`
      : "- There is no scope column: every site has scope null.",
    "- Only real, well-known sites you are sure exist, that people who rely on these facts actually use, and that publish them openly (no paywall or login).",
    "- Never SEO, scraper, aggregator-of-aggregators or anonymous listing sites.",
    "- Not the rows' own websites and not Wikipedia or Wikidata: those are always used.",
    "- host is the bare hostname (example.org), no path.",
  ].join("\n");
}

const same = (a: string, b: string) => foldCase(a).trim() === foldCase(b).trim();

/** Valid sites only, each scope matched to a listed value, deduped and capped. */
export function cleanDraft(draft: DraftSites, input: PlanInput): Omit<PlanSite, "status">[] {
  const out: Omit<PlanSite, "status">[] = [];
  const perScope = new Map<string, number>();
  for (const site of draft.sites) {
    const host = SiteSchema.safeParse(site.host).data;
    if (!host || ALWAYS_USED.some((h) => matchesHost(host, h))) continue;
    const scope = site.scope === null ? null : (input.scopes.find((s) => same(s.value, site.scope ?? ""))?.value ?? undefined);
    if (scope === undefined || (scope !== null && !input.scopeColumn)) continue;
    const key = scope ?? "";
    const cap = scope === null ? MAX_GLOBAL_SITES : MAX_SITES_PER_SCOPE;
    if ((perScope.get(key) ?? 0) >= cap || out.some((s) => s.host === host && s.scope === scope)) continue;
    perScope.set(key, (perScope.get(key) ?? 0) + 1);
    out.push({ host, role: site.role, scope });
  }
  return out.slice(0, MAX_SITES);
}

/** The plan's checked sites (dead ones dropped); [] if the call fails to give any. */
export async function planSites(input: PlanInput, fetchImpl: FetchLike = fetch): Promise<PlanSite[]> {
  const { parsed } = await extractStructured("suggest", DraftSitesSchema, sitesPrompt(input));
  if (!parsed) return [];
  const sites = cleanDraft(parsed, input);
  const checks = await checkSites(sites.map((s) => s.host), fetchImpl);
  return sites.flatMap((s) => {
    const check = checks.get(s.host) ?? "search_only";
    return check === "dead" ? [] : [{ ...s, status: check }];
  });
}

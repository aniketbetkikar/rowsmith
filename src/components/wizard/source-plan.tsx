"use client";

import { MAX_SITES, type PlanSite } from "@engine/contracts/job-config";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SiteAdder } from "./site-adder";
import { SiteGroup } from "./site-group";

const NONE = "__none";

type Props = {
  headers: string[];
  keyColumn: string;
  scopeColumn: string;
  sites: PlanSite[];
  onChange: (patch: { scopeColumn?: string; sites?: PlanSite[] }) => void;
};

/**
 * The source plan: the column that changes which sources are right, and the
 * sites to use for every row and per value of that column, each marked
 * readable or search only. Each row's own site and Wikipedia are always used.
 */
export function SourcePlan({ headers, keyColumn, scopeColumn, sites, onChange }: Props) {
  const scopes = [...new Set(sites.flatMap((s) => (s.scope === null ? [] : [s.scope])))];
  const groups: { title: string; sites: PlanSite[] }[] = [
    { title: "All rows", sites: sites.filter((s) => s.scope === null) },
    ...(scopeColumn ? scopes.map((scope) => ({ title: scope, sites: sites.filter((s) => s.scope === scope) })) : []),
  ].filter((g) => g.sites.length > 0);

  const remove = (site: PlanSite) =>
    onChange({ sites: sites.filter((s) => !(s.host === site.host && s.scope === site.scope)) });
  const add = (site: PlanSite) => {
    if (sites.some((s) => s.host === site.host && s.scope === site.scope)) return;
    onChange({ sites: [...sites, site] });
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="sources-heading">
      <div>
        <h3 id="sources-heading" className="font-semibold">
          Where to look
        </h3>
        <p className="text-sm text-muted-foreground">
          Sites used for these rows, ranked just below each row&apos;s own website. Wikipedia is always used. Green sites can be quoted
          word for word; amber ones only through search.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Sources change with</span>
        <Select value={scopeColumn || NONE} onValueChange={(v) => v && onChange({ scopeColumn: v === NONE ? "" : v })}>
          <SelectTrigger aria-label="Column that changes which sources are right" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Nothing (same for all rows)</SelectItem>
            {headers
              .filter((h) => h !== keyColumn)
              .map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {groups.length > 0 ? (
        <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/30 p-3">
          {groups.map((g) => (
            <SiteGroup key={g.title} title={g.title} sites={g.sites} onRemove={remove} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No sites yet. Use &ldquo;Suggest setup&rdquo; or add them below.</p>
      )}

      <SiteAdder scopeColumn={scopeColumn} scopes={scopes} disabled={sites.length >= MAX_SITES} onAdd={add} />
    </section>
  );
}

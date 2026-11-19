import type { JobConfig, PlanSite } from "@engine/contracts/job-config";
import type { RowInput } from "./build-prompt";
import { foldCase, type TierHints } from "./source-tier";

/**
 * A row's scope: its value in the job's scope column (the column that
 * changes which sources are right, such as a country, platform, region or
 * edition). Null when the job has none or the cell is blank.
 */
export function scopeOf(config: Pick<JobConfig, "scopeColumn">, input: Record<string, string>): string | null {
  return (config.scopeColumn && input[config.scopeColumn]?.trim()) || null;
}

const sameScope = (a: string, b: string) => foldCase(a).trim() === foldCase(b).trim();

/** The plan's sites for this row: those for every row plus those for its scope. */
export function rowSites(config: Pick<JobConfig, "scopeColumn" | "sites">, row: RowInput): PlanSite[] {
  const scope = scopeOf(config, row.input);
  return (config.sites ?? []).filter((s) => s.scope === null || (scope !== null && sameScope(s.scope, scope)));
}

/** Plan sites as tiers: registries rank with authorities, the rest as reference. */
export function tierHints(config: Pick<JobConfig, "scopeColumn" | "sites">, row: RowInput): TierHints {
  const sites = rowSites(config, row);
  return {
    authority: sites.filter((s) => s.role === "registry").map((s) => s.host),
    trusted: sites.filter((s) => s.role !== "registry").map((s) => s.host),
  };
}

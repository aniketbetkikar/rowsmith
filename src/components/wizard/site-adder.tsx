"use client";

import { SiteSchema, type PlanSite } from "@engine/contracts/job-config";
import { useState } from "react";
import { ROLE_LABELS } from "@/components/fields/role-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all";
const ROLES = ["registry", "reference", "listing"] as const;

type Props = {
  scopeColumn: string;
  /** Scope values the plan already has groups for. */
  scopes: string[];
  disabled: boolean;
  onAdd: (site: PlanSite) => void;
};

/** Adds a site by hand, for every row or one scope value (not checked). */
export function SiteAdder({ scopeColumn, scopes, disabled, onAdd }: Props) {
  const [host, setHost] = useState("");
  const [role, setRole] = useState<PlanSite["role"]>("reference");
  const [scope, setScope] = useState(ALL);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const parsed = SiteSchema.safeParse(host);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Use a site like example.org.");
      return;
    }
    onAdd({ host: parsed.data, role, scope: scope === ALL ? null : scope, status: "unchecked" });
    setHost("");
    setError(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Site to add"
          placeholder="example.org"
          className="w-48"
          value={host}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          onChange={(e) => {
            setHost(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Select value={role} onValueChange={(v) => v && setRole(v as PlanSite["role"])}>
          <SelectTrigger aria-label="Kind of source" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scopeColumn && (
          <Select value={scope} onValueChange={(v) => v && setScope(v)}>
            <SelectTrigger aria-label={`For which ${scopeColumn}`} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All rows</SelectItem>
              {scopes.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button type="button" variant="outline" disabled={disabled || !host.trim()} onClick={add}>
          Add site
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

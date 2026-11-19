"use client";

import { SOURCE_ROLES, type SourceRole } from "@engine/contracts/job-config";
import { cn } from "@/lib/utils";

export const ROLE_LABELS: Record<SourceRole, string> = {
  own: "Own pages",
  registry: "Registry",
  reference: "Reference",
  listing: "Listing",
};

const ROLE_HINTS: Record<SourceRole, string> = {
  own: "The entity's or its maker's own pages",
  registry: "Whoever regulates, certifies or officially records it",
  reference: "Reference works",
  listing: "Platforms where it is listed and kept current",
};

type Props = {
  value: SourceRole[];
  onChange: (roles: SourceRole[]) => void;
};

/** Kinds of source for one field, best first: click to add at the end, click again to remove. */
export function RolePicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" role="group" aria-label="Kinds of source, best first">
      <span className="shrink-0">Kinds of source, best first:</span>
      {SOURCE_ROLES.map((role) => {
        const at = value.indexOf(role);
        const on = at >= 0;
        return (
          <button
            key={role}
            type="button"
            title={ROLE_HINTS[role]}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((r) => r !== role) : [...value, role])}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              on ? "border-primary/50 bg-secondary text-secondary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {on && <span className="font-semibold text-primary">{at + 1}</span>}
            {ROLE_LABELS[role]}
          </button>
        );
      })}
    </div>
  );
}

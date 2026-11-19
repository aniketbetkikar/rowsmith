"use client";

import type { PlanSite, SiteStatus } from "@engine/contracts/job-config";
import { XIcon } from "lucide-react";
import { ROLE_LABELS } from "@/components/fields/role-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS: Record<SiteStatus, { label: string; dot: string }> = {
  readable: { label: "Readable: its pages can be quoted", dot: "bg-emerald-500" },
  search_only: { label: "Search only: it blocks reading, needs a login or a script", dot: "bg-amber-500" },
  unchecked: { label: "Added by you, not checked", dot: "bg-muted-foreground/50" },
};

type Props = {
  title: string;
  sites: PlanSite[];
  onRemove: (site: PlanSite) => void;
};

/** One scope's sites (or every row's) as removable chips with role and status. */
export function SiteGroup({ title, sites, onRemove }: Props) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <p className="w-40 shrink-0 pt-1 text-sm font-medium">{title}</p>
      <ul className="flex flex-wrap gap-1.5" aria-label={`Sites for ${title}`}>
        {sites.map((site) => (
          <li
            key={`${site.host}-${site.scope ?? ""}`}
            className="flex items-center gap-1.5 rounded-full border bg-card py-0.5 pr-1 pl-2.5 text-sm"
            title={STATUS[site.status].label}
          >
            <span className={cn("size-2 shrink-0 rounded-full", STATUS[site.status].dot)} aria-label={STATUS[site.status].label} role="img" />
            {site.host}
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[site.role]}</span>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${site.host}`} onClick={() => onRemove(site)}>
              <XIcon aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

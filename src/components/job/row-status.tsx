"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RowView } from "@/lib/api";
import { cn } from "@/lib/utils";

const DOT: Record<RowView["status"], string> = {
  done: "bg-success",
  failed: "bg-destructive",
  duplicate: "bg-primary",
  pending: "bg-muted-foreground/50 motion-safe:animate-pulse",
};

type Props = { status: RowView["status"]; error: RowView["error"] };

/** A dot and a word; a failed row explains itself in a tooltip. */
export function RowStatus({ status, error }: Props) {
  const label = (
    <span className={cn("inline-flex items-center gap-1.5 text-sm capitalize", status === "failed" && "text-destructive")}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[status])} />
      {status}
    </span>
  );
  if (!error) return label;
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-help rounded underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {label}
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{error}</TooltipContent>
    </Tooltip>
  );
}

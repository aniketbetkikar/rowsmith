"use client";

import { QuoteIcon } from "lucide-react";
import type { CellEvidence, Source } from "@engine/contracts/row-result";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { blankLabel, formatValue, hostname, isHttpUrl } from "@/lib/format";

type Props = {
  value: unknown;
  /** Absent for values the user supplied (nothing was researched). */
  evidence: CellEvidence | undefined;
  sources: Source[];
};

/** Source numbers are 1-based positions in the row's sources. */
function sourceName(sources: Source[], n: number): string {
  const source = sources[n - 1];
  return source ? hostname(source.url) : `source ${n}`;
}

const TRIGGER ="cursor-help rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function Text({ text }: { text: string }) {
  if (isHttpUrl(text)) {
    return (
      <a href={text} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
        {hostname(text)}
      </a>
    );
  }
  // Long answers are clamped; the full text is one hover away.
  return (
    <span className="line-clamp-3" title={text.length > 90 ? text : undefined}>
      {text}
    </span>
  );
}

/** A researched value with the source quotes behind it, or why it is blank. */
export function CellValue({ value, evidence, sources }: Props) {
  const text = formatValue(value);
  if (text === null) {
    return (
      <Tooltip>
        <TooltipTrigger className={`${TRIGGER} text-muted-foreground`} aria-label={blankLabel(evidence?.blank)}>
          —
        </TooltipTrigger>
        <TooltipContent>{blankLabel(evidence?.blank)}</TooltipContent>
      </Tooltip>
    );
  }

  const quotes = evidence?.quotes ?? [];
  if (quotes.length === 0) return <Text text={text} />;
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <Text text={text} />
      </div>
      <Tooltip>
        <TooltipTrigger className={`${TRIGGER} mt-0.5 shrink-0 text-muted-foreground hover:text-foreground`} aria-label="Show source quote">
          <QuoteIcon className="size-3" />
        </TooltipTrigger>
        <TooltipContent className="max-w-sm flex-col items-start gap-2">
          {quotes.map((q, i) => (
            <span key={i} className="flex flex-col gap-0.5">
              <span>&ldquo;{q.text}&rdquo;</span>
              <span className="opacity-70">
                {q.sources.map((n) => sourceName(sources, n)).join(", ")}
                {q.origin === "search" && " · search summary, not page text"}
              </span>
            </span>
          ))}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

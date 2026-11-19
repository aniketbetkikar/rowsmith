import type { JobStatusResponse } from "@/lib/api";
import { formatUsd } from "@/lib/format";

/** Cost per researched row (duplicates are free), or null if none finished. */
export function previewCostPerRow(job: JobStatusResponse): number | null {
  const finished = job.done + job.failed;
  return finished > 0 ? job.costUsd / finished : null;
}

type Props = {
  /** The completed preview job. */
  preview: JobStatusResponse;
  /** Rows the full run will process (already capped). */
  fullRows: number;
};

/** The band's top lines for a finished preview: the full run's estimated total, then where it comes from. */
export function CostEstimate({ preview, fullRows }: Props) {
  const perRow = previewCostPerRow(preview) ?? 0;
  const previewRows = preview.total + preview.duplicates;

  return (
    <div className="flex flex-col gap-2.5" aria-live="polite">
      <p className="font-display text-4xl leading-none font-bold tracking-[-0.01em] sm:text-5xl">
        <span className="text-band-brass">≈ {formatUsd(perRow * fullRows)}</span>{" "}
        <span className="text-2xl font-semibold text-band-muted sm:text-3xl">estimated total for {fullRows} rows</span>
      </p>
      <p className="max-w-3xl text-sm text-band-muted sm:text-base">
        From the preview of {previewRows} rows, which cost {formatUsd(preview.costUsd)} ({formatUsd(perRow)} per row).
        Rows the preview filled are reused, not run again. The real cost varies with how much each row needs.
      </p>
    </div>
  );
}

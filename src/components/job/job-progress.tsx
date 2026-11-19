"use client";

import { AlertCircleIcon, ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import type { JobStatusResponse } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { formatDuration, formatEstimate, formatPerField, minutesSaved } from "@/lib/time-saved";
import { cn } from "@/lib/utils";
import { CostEstimate, previewCostPerRow } from "./cost-estimate";

const STATUS_LABEL: Record<JobStatusResponse["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_DOT: Record<JobStatusResponse["status"], string> = {
  queued: "bg-band-muted",
  running: "bg-band-foreground motion-safe:animate-pulse",
  completed: "bg-band-success",
  failed: "bg-band-danger",
};

type Props = {
  job: JobStatusResponse;
  /** Shown at the band's top right, e.g. the download button. */
  action?: ReactNode;
  /** Minutes per field for the time-saved estimate (from env). */
  minutesPerField: number;
  /** Wizard preview only: once completed, the top lines show the cost estimate for this many rows. */
  estimateRows?: number;
};

/** The results band: research time saved first, then what it cost, then progress. */
export function JobProgress({ job, action, minutesPerField, estimateRows }: Props) {
  const finished = job.done + job.failed;
  const percent = job.total > 0 ? Math.round((finished / job.total) * 100) : job.status === "completed" ? 100 : 0;
  const perRow = finished > 0 ? job.costUsd / finished : 0;
  const settled = job.status === "completed" || job.status === "failed";
  const took = job.finishedAt ? formatDuration(Date.parse(job.finishedAt) - Date.parse(job.createdAt)) : null;
  const saved = formatEstimate(minutesSaved(job.filledCells, minutesPerField));
  const cost = <span className="font-semibold text-band-brass">{formatUsd(job.costUsd)}</span>;
  const showEstimate = estimateRows !== undefined && job.status === "completed" && previewCostPerRow(job) !== null;

  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="Time saved, cost and progress"
        className="overflow-hidden rounded-xl bg-band text-band-foreground dark:ring-1 dark:ring-band-rule"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 px-5 pt-6 pb-5 sm:px-8">
          {showEstimate ? (
            <CostEstimate preview={job} fullRows={estimateRows} />
          ) : (
            <div className="flex flex-col gap-2.5">
              <p className="font-display text-4xl leading-none font-bold tracking-[-0.01em] sm:text-5xl">
                {job.filledCells > 0 ? saved : "—"}{" "}
                <span className="text-2xl font-semibold text-band-muted sm:text-3xl">
                  of research{settled ? "" : " so far"}
                </span>
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-lg sm:text-xl">
                <ArrowRightIcon className="size-5 text-band-muted" aria-hidden />
                {settled && took ? (
                  <span>
                    done in {took} for {cost}
                  </span>
                ) : (
                  <span>{cost} spent so far</span>
                )}
              </p>
            </div>
          )}
          {action}
        </div>

        <div className="flex flex-col gap-2 border-t border-band-rule px-5 py-4 sm:px-8">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <Stat value={job.filledCells} label={job.filledCells === 1 ? "field filled" : "fields filled"} />
            <Stat value={job.blankCells} label="left blank (not found)" />
            {job.duplicates > 0 && (
              <Stat value={job.duplicates} label={job.duplicates === 1 ? "duplicate free" : "duplicates free"} />
            )}
            {job.failed > 0 && <Stat value={job.failed} label={job.failed === 1 ? "row failed" : "rows failed"} danger />}
            {finished > 0 && <span className="text-band-muted tabular-nums sm:ml-auto">{formatUsd(perRow)} per row</span>}
          </div>
          <p className="text-sm text-band-muted">
            Compared with about {formatPerField(minutesPerField)} per field in LLMs: prompting, checking
            sources and fixing the output.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-band-rule px-5 py-4 sm:px-8">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <span aria-hidden className={cn("size-2 rounded-full", STATUS_DOT[job.status])} />
              {STATUS_LABEL[job.status]}
            </span>
            <span className="tabular-nums" aria-live="polite">
              {finished} of {job.total} rows
            </span>
            <span className="ml-auto text-band-muted tabular-nums">{percent}%</span>
          </div>
          <Progress
            value={percent}
            aria-label="Job progress"
            className="**:data-[slot=progress-indicator]:bg-band-foreground **:data-[slot=progress-track]:h-1.5 **:data-[slot=progress-track]:bg-band-rule"
          />
        </div>
      </section>

      {job.status === "failed" && job.error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>The job failed</AlertTitle>
          <AlertDescription>{job.error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function Stat({ value, label, danger }: { value: number; label: string; danger?: boolean }) {
  return (
    <span className={danger ? "text-band-danger" : "text-band-muted"}>
      <span className={cn("font-semibold tabular-nums", danger ? "text-band-danger" : "text-band-foreground")}>{value}</span>{" "}
      {label}
    </span>
  );
}

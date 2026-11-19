"use client";

import { useEffect } from "react";
import { useJob } from "@/hooks/use-job";
import type { JobStatusResponse } from "@/lib/api";
import { DownloadButton } from "./download-button";
import { JobProgress } from "./job-progress";
import { ResultTable } from "./result-table";
import { RetryButton } from "./retry-button";

type Props = {
  jobId: string;
  initial?: JobStatusResponse;
  /** The wizard's inline preview has no download button. */
  showDownload?: boolean;
  /** Minutes per field for the time-saved estimate. */
  minutesPerField: number;
  /** Called with every status update, e.g. so the wizard can estimate the full run's cost. */
  onData?: (data: JobStatusResponse) => void;
  /** Wizard preview only: rows of the full run, for the cost estimate shown once the preview completes. */
  estimateRows?: number;
};

/** Polls the job once and feeds progress, results and download. */
export function JobView({ jobId, initial, showDownload = true, minutesPerField, onData, estimateRows }: Props) {
  const { data, error, isLoading, refresh } = useJob(jobId, initial);
  useEffect(() => {
    if (data) onData?.(data);
  }, [data, onData]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Starting…</p>;
  if (!data) {
    return <p className="text-sm text-destructive">Couldn&apos;t load the job: {error?.message ?? "unknown error"}</p>;
  }

  const version = `${data.status}:${data.done}:${data.failed}`;
  const canRetry = data.status === "completed" && data.retryable > 0;
  const action =
    canRetry || showDownload ? (
      <div className="flex flex-wrap items-center gap-2">
        {canRetry && <RetryButton jobId={jobId} count={data.retryable} onRetried={refresh} />}
        {showDownload && <DownloadButton jobId={jobId} ready={data.status === "completed"} />}
      </div>
    ) : undefined;
  return (
    <div className="flex flex-col gap-5">
      <JobProgress
        job={data}
        minutesPerField={minutesPerField}
        action={action}
        estimateRows={estimateRows}
      />
      {error && <p className="text-xs text-muted-foreground">Reconnecting… ({error.message})</p>}
      <ResultTable jobId={jobId} fields={data.fields} version={version} />
    </div>
  );
}

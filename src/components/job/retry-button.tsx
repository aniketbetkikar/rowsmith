"use client";

import { RotateCwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RetryJobResponseSchema } from "@/lib/api";
import { errorText, postJson } from "@/lib/fetch-json";

type Props = {
  jobId: string;
  /** Failed rows that will be sent again. */
  count: number;
  /** Called once the retry is queued, so polling starts again. */
  onRetried: () => void;
};

// Outlined on the dark results band, next to the solid download button.
const ON_BAND =
  "h-9 px-3.5 bg-transparent text-band-foreground border-band-rule hover:bg-band-foreground/10 disabled:opacity-40";

/** Sends a finished job's failed rows through the pipeline again. */
export function RetryButton({ jobId, count, onRetried }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/jobs/${jobId}/retry`, RetryJobResponseSchema, {});
      onRetried();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-band-danger">{error}</span>}
      <Button variant="outline" disabled={busy} onClick={() => void retry()} className={ON_BAND}>
        <RotateCwIcon className={busy ? "motion-safe:animate-spin" : undefined} />
        Retry {count} failed {count === 1 ? "row" : "rows"}
      </Button>
    </div>
  );
}

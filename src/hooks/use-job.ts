"use client";

import { useCallback, useEffect, useState } from "react";
import { JobStatusResponseSchema, type JobStatusResponse } from "@/lib/api";
import { ApiClientError, fetchJson } from "@/lib/fetch-json";

const POLL_MS = 2000;
const TERMINAL = new Set<JobStatusResponse["status"]>(["completed", "failed"]);

export type UseJobResult = {
  data: JobStatusResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  /** Starts polling again, e.g. after a retry reopened a finished job. */
  refresh: () => void;
};

/**
 * Polls /api/jobs/[id] every 2 s while the job is queued or running, stops
 * once it is completed or failed, and pauses while the tab is hidden.
 * The interface stays the same if SSE replaces polling later.
 */
export function useJob(id: string | null, initial?: JobStatusResponse): UseJobResult {
  const [data, setData] = useState<JobStatusResponse | undefined>(initial);
  const [error, setError] = useState<Error | undefined>();
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!id) return;
    // A finished initial snapshot needs no polling, until refresh() is called.
    let stopped = initial && round === 0 ? TERMINAL.has(initial.status) : false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void tick();
      }, ms);
    };

    const tick = async () => {
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const next = await fetchJson(`/api/jobs/${id}`, JobStatusResponseSchema);
        if (stopped) return;
        setData(next);
        setError(undefined);
        if (TERMINAL.has(next.status)) stopped = true;
        else schedule(POLL_MS);
      } catch (err) {
        if (stopped) return;
        setError(err instanceof Error ? err : new Error("Failed to load job."));
        if (err instanceof ApiClientError && err.status === 404) stopped = true;
        else schedule(err instanceof ApiClientError && err.retryAfter ? err.retryAfter * 1000 : POLL_MS * 2);
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !timer) void tick();
    };

    if (!stopped) void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, initial, round]);

  const refresh = useCallback(() => setRound((r) => r + 1), []);
  return { data, error, isLoading: Boolean(id) && !data && !error, refresh };
}

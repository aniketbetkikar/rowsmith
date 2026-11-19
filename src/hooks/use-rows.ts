"use client";

import { useEffect, useState } from "react";
import { RowsResponseSchema, type RowsResponse } from "@/lib/api";
import { fetchJson } from "@/lib/fetch-json";

/**
 * Loads one page of a job's rows, and reloads whenever `version` changes
 * (e.g. the done/failed counters from useJob), so the table refreshes in
 * step with the progress poll instead of polling on its own.
 */
export function useRows(id: string | null, version: string, page = 1, size = 50) {
  const [data, setData] = useState<RowsResponse | undefined>();
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchJson(`/api/jobs/${id}/rows?page=${page}&size=${size}`, RowsResponseSchema).then(
      (next) => {
        if (cancelled) return;
        setData(next);
        setError(undefined);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error("Failed to load rows."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, version, page, size]);

  return { data, error };
}

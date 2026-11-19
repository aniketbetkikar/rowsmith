"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRows } from "@/hooks/use-rows";
import type { RowView } from "@/lib/api";
import { formatUsd, hostname } from "@/lib/format";
import { CellValue } from "./cell-value";
import { RowStatus } from "./row-status";

const PAGE_SIZE = 50;
// Pinned to the right edge: the per-row cost stays in view however wide the table is.
const COST_CELL = "sticky right-0 z-10 border-l text-right shadow-[-6px_0_8px_-6px_rgb(0_0_0/0.12)]";

type Props = {
  jobId: string;
  fields: string[];
  /** Changes whenever the job's counters change, to refresh the rows. */
  version: string;
};

type SourceSite = { host: string; url: string; pages: string[] };

/** The row's sources grouped by host, in first-cited order; each page keeps its source number. */
function bySite(sources: RowView["sources"]): SourceSite[] {
  const sites = new Map<string, SourceSite>();
  sources.forEach((s, i) => {
    const host = hostname(s.url);
    const page = `[${i + 1}] ${s.title || s.url}`;
    const site = sites.get(host);
    if (site) site.pages.push(page);
    else sites.set(host, { host, url: s.url, pages: [page] });
  });
  return [...sites.values()];
}

/** One link chip per site the row cites; the tooltip lists every page from that site. */
function Sources({ sources }: { sources: RowView["sources"] }) {
  return (
    <div className="flex w-72 flex-wrap gap-1">
      {bySite(sources).map((site) => (
        <a
          key={site.host}
          href={site.url}
          title={site.pages.join("\n")}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-36 truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
        >
          {site.host}
          {site.pages.length > 1 && <span className="ml-1 opacity-70">×{site.pages.length}</span>}
        </a>
      ))}
    </div>
  );
}

export function ResultTable({ jobId, fields, version }: Props) {
  const [page, setPage] = useState(1);
  const { data, error } = useRows(jobId, version, page, PAGE_SIZE);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load results: {error.message}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading results…</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead className="sticky left-0 z-10 bg-muted text-xs">Key</TableHead>
              {fields.map((f) => (
                <TableHead key={f} className="text-xs">
                  {f}
                </TableHead>
              ))}
              <TableHead className="text-xs">Sources</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className={`${COST_CELL} bg-muted text-xs`}>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row, i) => (
              <TableRow key={`${row.key}-${i}`} className="group/row *:align-top">
                <TableCell className="sticky left-0 z-10 bg-card font-semibold group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]">
                  {row.key || <span className="font-normal text-muted-foreground">(empty)</span>}
                </TableCell>
                {fields.map((f) => (
                  <TableCell key={f} className="max-w-72 min-w-32 whitespace-normal">
                    {row.status === "pending" ? <span className="text-muted-foreground">…</span> : <CellValue value={row.output?.[f]} evidence={row.evidence[f]} sources={row.sources} />}
                  </TableCell>
                ))}
                <TableCell>
                  <Sources sources={row.sources} />
                </TableCell>
                <TableCell>
                  <RowStatus status={row.status} error={row.error} />
                </TableCell>
                <TableCell className={`${COST_CELL} bg-card font-semibold text-brass tabular-nums group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]`}>
                  {formatUsd(row.costUsd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

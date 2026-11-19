"use client";

import { FileSpreadsheetIcon, TableIcon, UploadIcon } from "lucide-react";
import { ROW_CAPS } from "@engine/contracts/job-status";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_CSV_BYTES, MAX_CSV_ROWS } from "@/lib/api";
import { MAX_FIELDS } from "@/lib/draft";
import { CsvError, parseCsv, type CsvRow } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { SampleTable } from "./sample-table";

export type UploadedCsv = {
  fileName: string;
  csv: string;
  headers: string[];
  rows: CsvRow[];
};

const SAMPLE_CSV = `name,country
Notion,USA
Canva,Australia
Zerodha,India
Razorpay,India
Freshworks,India
`;

/** Parses and checks an upload; returns an error message or the parsed CSV. */
export function readCsv(fileName: string, csv: string): UploadedCsv | string {
  if (new TextEncoder().encode(csv).length > MAX_CSV_BYTES) return "The file is larger than 1 MB.";
  try {
    const { headers, rows } = parseCsv(csv);
    if (rows.length === 0) return "The CSV has a header row but no data rows.";
    if (rows.length > MAX_CSV_ROWS) return `The CSV has ${rows.length} rows; the limit is ${MAX_CSV_ROWS}.`;
    return { fileName, csv, headers, rows };
  } catch (err) {
    return err instanceof CsvError ? err.message : "Could not read this file as CSV.";
  }
}

type Props = {
  value: UploadedCsv | null;
  onChange: (upload: UploadedCsv) => void;
  onNext: () => void;
};

export function UploadStep({ value, onChange, onNext }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = (fileName: string, text: string) => {
    const result = readCsv(fileName, text);
    if (typeof result === "string") {
      setError(result);
      return;
    }
    setError(null);
    onChange(result);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      setError("The file is larger than 1 MB.");
      return;
    }
    accept(file.name, await file.text());
  };

  const loadSample = () => accept("sample-companies.csv", SAMPLE_CSV);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a CSV file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void readFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          dragging ? "border-primary bg-secondary" : "border-input hover:border-primary/60 hover:bg-secondary/50",
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          {value ? <FileSpreadsheetIcon className="size-5" /> : <UploadIcon className="size-5" />}
        </span>
        <p className="font-medium">{value ? value.fileName : "Drop a CSV here, or click to choose"}</p>
        <p className="text-sm text-muted-foreground">
          {value
            ? "Drop another file or click to replace it."
            : `Up to ${ROW_CAPS.full} rows and ${MAX_FIELDS} columns to fill. One row per entity, with a column that names it.`}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void readFile(e.target.files?.[0])}
        />
      </div>

      {!value && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <span>No CSV handy?</span>
          <Button type="button" variant="outline" size="lg" className="px-3.5" onClick={loadSample}>
            <TableIcon /> Use a sample file
          </Button>
          <span>5 companies, ready to try.</span>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {value && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{value.rows.length} rows</span> and{" "}
            <span className="font-medium text-foreground tabular-nums">{value.headers.length} columns</span>. Here are
            the first 5:
          </p>
          <SampleTable headers={value.headers} rows={value.rows.slice(0, 5)} />
        </div>
      )}

      <div className="flex justify-end border-t pt-5">
        <Button type="button" size="lg" className="px-4" disabled={!value} onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}

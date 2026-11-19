"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MAX_CONTEXT_COLUMNS } from "@/lib/draft";

type Props = {
  headers: string[];
  keyColumn: string;
  value: string[];
  onChange: (columns: string[]) => void;
};

/** Existing columns that help tell similar entities apart (e.g. city). */
export function ContextPicker({ headers, keyColumn, value, onChange }: Props) {
  const options = headers.filter((h) => h !== keyColumn);
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">No other columns in this file.</p>;
  }

  const toggle = (column: string, checked: boolean) =>
    onChange(checked ? [...value, column] : value.filter((c) => c !== column));

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((column) => {
        const checked = value.includes(column);
        const id = `context-${column}`;
        return (
          <div
            key={column}
            className="flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-2 transition-colors has-data-checked:border-primary/50 has-data-checked:bg-secondary has-data-disabled:opacity-60"
          >
            <Checkbox
              id={id}
              checked={checked}
              disabled={!checked && value.length >= MAX_CONTEXT_COLUMNS}
              onCheckedChange={(next) => toggle(column, next === true)}
            />
            <Label htmlFor={id} className="cursor-pointer font-normal">
              {column}
            </Label>
          </div>
        );
      })}
    </div>
  );
}

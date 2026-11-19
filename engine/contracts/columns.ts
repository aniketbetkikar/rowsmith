import { z } from "zod";

/** Values a summary lists per column (the most common first). */
export const MAX_COLUMN_VALUES = 30;

/**
 * One CSV column over the whole file: how many distinct values it has and
 * the most common ones. Lets suggest see every row's scope (e.g. all the
 * countries in the file), not just the sample rows.
 */
export const ColumnSummarySchema = z.object({
  header: z.string(),
  distinct: z.number().int().nonnegative(),
  top: z.array(z.object({ value: z.string(), count: z.number().int().positive() })).max(MAX_COLUMN_VALUES),
});

export type ColumnSummary = z.infer<typeof ColumnSummarySchema>;

/** Summaries of every column (blank cells ignored). */
export function summarizeColumns(headers: string[], rows: Record<string, string>[]): ColumnSummary[] {
  return headers.map((header) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[header]?.trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const top = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_COLUMN_VALUES)
      .map(([value, count]) => ({ value: value.slice(0, 100), count }));
    return { header, distinct: counts.size, top };
  });
}

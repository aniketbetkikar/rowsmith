import { parse, unparse } from "papaparse";

export type CsvRow = Record<string, string>;

export type ParsedCsv = {
  headers: string[];
  rows: CsvRow[];
};

/** A CSV the user uploaded could not be parsed; the message is user-facing. */
export class CsvError extends Error {
  override readonly name = "CsvError";
}

const BOM = 0xfeff;

// Cells starting with these would run as formulas in Excel/Sheets
// (negative numbers are left alone).
const FORMULA_START = /^(?:[=+@\t\r]|-(?![\d.]))/;

function stripBom(text: string): string {
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/**
 * Parses CSV text with the first row as headers. Headers must be non-empty
 * and unique. Blank lines are skipped, short rows are padded with "", and
 * rows with more cells than headers are rejected.
 */
export function parseCsv(text: string): ParsedCsv {
  const result = parse<string[]>(stripBom(text), {
    header: false,
    skipEmptyLines: "greedy",
  });

  const fatal = result.errors.find((e) => e.type !== "Delimiter");
  if (fatal) {
    const where = fatal.row !== undefined ? ` (row ${fatal.row + 1})` : "";
    throw new CsvError(`Could not parse CSV${where}: ${fatal.message}`);
  }

  const [headerRow, ...dataRows] = result.data;
  if (!headerRow || headerRow.length === 0) {
    throw new CsvError("The CSV is empty.");
  }

  const headers = headerRow.map((h) => h.trim());
  const blank = headers.findIndex((h) => h === "");
  if (blank !== -1) {
    throw new CsvError(`Column ${blank + 1} has an empty header.`);
  }
  const duplicate = headers.find((h, i) => headers.indexOf(h) !== i);
  if (duplicate) {
    throw new CsvError(`Duplicate column header "${duplicate}".`);
  }

  const rows = dataRows.map((cells, i) => {
    if (cells.length > headers.length) {
      throw new CsvError(
        `Row ${i + 2} has ${cells.length} cells but there are only ${headers.length} columns.`,
      );
    }
    return Object.fromEntries(
      headers.map((h, col) => [h, (cells[col] ?? "").trim()]),
    );
  });

  return { headers, rows };
}

/** Serialises rows in header order. Missing cells become "". */
export function toCsv(headers: string[], rows: CsvRow[]): string {
  return unparse(
    {
      fields: headers,
      data: rows.map((row) => headers.map((h) => row[h] ?? "")),
    },
    { escapeFormulae: FORMULA_START },
  );
}

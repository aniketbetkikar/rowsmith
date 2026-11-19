import type { FieldDef } from "@engine/contracts/job-config";

// Scoring rules (engine-spec section 12):
//   enum / year / number / boolean → exact match
//   url / text                     → normalised match
//   list                           → set overlap (Jaccard), partial credit
// Null handling:
//   gold null + predicted null     → correct (honest "unknown")
//   gold value + predicted null    → miss (score 0, not "wrong")
//   gold null + predicted value    → wrong (invented)
// Both runs (Rowsmith and baseline) use the same scorer. Values are lightly
// coerced ("2013" → 2013, "TRUE" → true, enum case) so the comparison is
// about facts, not formatting.

export type CellScore = {
  /** 0..1 (lists can earn partial credit). */
  score: number;
  predictedNull: boolean;
  /** A non-null prediction that is wrong: invented or incorrect. */
  wrong: boolean;
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Scheme, "www.", query, hash and trailing slash do not matter. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim().toLowerCase();
  try {
    const url = new URL(/^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return trimmed;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "yes") return true;
    if (v === "false" || v === "no") return false;
  }
  return null;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[|,;]/);
  return [];
}

export function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function listOverlap(gold: string[], predicted: string[]): number {
  const a = new Set(gold.map(normalizeText).filter(Boolean));
  const b = new Set(predicted.map(normalizeText).filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / new Set([...a, ...b]).size;
}

function matchScore(field: FieldDef, gold: unknown, predicted: unknown): number {
  switch (field.type) {
    case "number":
    case "year": {
      const g = toNumber(gold);
      return g !== null && g === toNumber(predicted) ? 1 : 0;
    }
    case "boolean": {
      const g = toBoolean(gold);
      return g !== null && g === toBoolean(predicted) ? 1 : 0;
    }
    case "enum":
      return String(gold).trim().toLowerCase() === String(predicted).trim().toLowerCase()
        ? 1
        : 0;
    case "url":
      return normalizeUrl(String(gold)) === normalizeUrl(String(predicted)) ? 1 : 0;
    case "text":
      return normalizeText(String(gold)) === normalizeText(String(predicted)) ? 1 : 0;
    case "list":
      return listOverlap(toList(gold), toList(predicted));
  }
}

export function scoreCell(field: FieldDef, gold: unknown, predicted: unknown): CellScore {
  const predictedNull = isEmpty(predicted);
  if (isEmpty(gold)) {
    return { score: predictedNull ? 1 : 0, predictedNull, wrong: !predictedNull };
  }
  if (predictedNull) return { score: 0, predictedNull, wrong: false };
  const score = matchScore(field, gold, predicted);
  return { score, predictedNull, wrong: score === 0 };
}

export type EvalRowResult = {
  key: string;
  gold: Record<string, unknown>;
  /** null when the row failed: every field counts as predicted null. */
  predicted: Record<string, unknown> | null;
  status: "done" | "failed";
  costUsd: number;
  attempts: number;
};

export type Rates = {
  accuracy: number;
  nullRate: number;
  wrongRate: number;
  /** Wrong cells among the filled (non-null) ones: how often a filled value can't be trusted. */
  falseRate: number;
};

export type EvalReport = {
  rows: number;
  failedRows: number;
  perField: (Rates & { name: string })[];
  overall: Rates;
  avgCostUsd: number;
  avgAttempts: number;
};

function rates(cells: CellScore[]): Rates {
  const n = Math.max(cells.length, 1);
  const wrong = cells.filter((c) => c.wrong).length;
  const filled = cells.filter((c) => !c.predictedNull).length;
  return {
    accuracy: cells.reduce((sum, c) => sum + c.score, 0) / n,
    nullRate: cells.filter((c) => c.predictedNull).length / n,
    wrongRate: wrong / n,
    falseRate: wrong / Math.max(filled, 1),
  };
}

export function summarize(fields: FieldDef[], results: EvalRowResult[]): EvalReport {
  const byField = new Map<string, CellScore[]>(fields.map((f) => [f.name, []]));
  for (const r of results) {
    for (const field of fields) {
      byField
        .get(field.name)
        ?.push(scoreCell(field, r.gold[field.name], r.predicted?.[field.name] ?? null));
    }
  }
  const all = [...byField.values()].flat();
  const n = Math.max(results.length, 1);
  return {
    rows: results.length,
    failedRows: results.filter((r) => r.status === "failed").length,
    perField: fields.map((f) => ({ name: f.name, ...rates(byField.get(f.name) ?? []) })),
    overall: rates(all),
    avgCostUsd: results.reduce((sum, r) => sum + r.costUsd, 0) / n,
    avgAttempts: results.reduce((sum, r) => sum + r.attempts, 0) / n,
  };
}

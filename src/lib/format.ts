import type { BlankReason } from "@engine/contracts/row-result";

/** USD with enough precision for sub-cent per-row costs. */
export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** An output value for display; null when the value is unknown. */
export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(", ") : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

const BLANK_LABEL: Record<BlankReason, string> = {
  not_found: "Not found in sources",
  unsupported: "Removed: no source quote states it",
  rejected: "Removed: the source quote doesn't support it",
};

/** Why a researched cell is blank, in words. */
export function blankLabel(reason: BlankReason | undefined): string {
  return BLANK_LABEL[reason ?? "not_found"];
}

import { z } from "zod";

export const SourceSchema = z.object({
  url: z.string(),
  title: z.string(),
});

const count = z.number().int().nonnegative();

export const UsageSchema = z.object({
  inputTokens: count,
  outputTokens: count,
  cachedTokens: count,
  searchCalls: count,
});

export type Source = z.infer<typeof SourceSchema>;
export type Usage = z.infer<typeof UsageSchema>;

/**
 * Words copied from one grounded claim, or from up to 3 joined with " … ",
 * plus the sources backing those claims (1-based positions in the row's
 * `sources`).
 */
export const QuoteSchema = z.object({
  text: z.string(),
  sources: z.array(z.number().int().positive()),
  /**
   * page    every part was copied from a page we read ourselves
   * search  some part is the search model's summary (no readable page stated it)
   * Absent on rows saved before pages were read.
   */
  origin: z.enum(["page", "search"]).optional(),
});

/**
 * Why a researched cell is blank:
 *   not_found    the sources didn't state a value
 *   unsupported  a value was given, but its quote isn't in the sourced claims
 *   rejected     the quote exists, but the verify pass found it doesn't support the value
 */
export const BlankReasonSchema = z.enum(["not_found", "unsupported", "rejected"]);

export const CellEvidenceSchema = z.object({
  /** One per value; for lists, one per item in the same order. Empty when blank. */
  quotes: z.array(QuoteSchema),
  blank: BlankReasonSchema.optional(),
});

/**
 * A value extraction gave that our checks dropped, with its quotes and why.
 * Kept on the row for debugging; never shown or exported.
 */
export const RejectedValueSchema = z.object({
  value: z.unknown(),
  quotes: z.array(z.string()),
  reason: BlankReasonSchema,
});
/** Per field name. */
export const RejectedSchema = z.record(z.string(), z.array(RejectedValueSchema));
export type RejectedValue = z.infer<typeof RejectedValueSchema>;
export type Rejected = z.infer<typeof RejectedSchema>;

/** Per field name. */
export const EvidenceSchema = z.record(z.string(), CellEvidenceSchema);

export type Quote = z.infer<typeof QuoteSchema>;
export type BlankReason = z.infer<typeof BlankReasonSchema>;
export type CellEvidence = z.infer<typeof CellEvidenceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

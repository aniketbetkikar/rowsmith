import type { BlankReason, Evidence } from "@engine/contracts/row-result";
import type { RowDoc } from "@engine/db/rows";

type CommentRow = Pick<RowDoc, "key" | "status" | "sources">;

/** "a", "a and b", "a, b and c". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** One sentence per blank reason, naming the fields it covers. */
function reasonSentence(reason: BlankReason, fields: string[], key: string, sourceCount: number): string {
  const names = joinNames(fields);
  const many = fields.length > 1;
  const it = many ? "they" : "it";
  switch (reason) {
    case "not_found":
      return sourceCount === 0
        ? `No web sources were found, so ${names} ${many ? "were" : "was"} left blank.`
        : `None of the ${sourceCount} sources mention${sourceCount === 1 ? "s" : ""} ${names} for ${key}: ${it} may not apply, or ${it} ${many ? "aren't" : "isn't"} published online.`;
    case "unsupported":
      return `A value for ${names} was found, but no cited source states ${many ? "them" : "it"}, so ${it} ${many ? "were" : "was"} left out rather than guessed.`;
    case "rejected":
      return `Sources were found for ${names}, but on checking they didn't state ${many ? "them" : "it"} for ${key} exactly (for example another edition, scope or date), so ${it} ${many ? "were" : "was"} left out.`;
  }
}

/** Filled fields whose evidence is the search's summary, not a page we read. */
function summarySentence(fields: string[]): string {
  const many = fields.length > 1;
  return `${joinNames(fields)} ${many ? "come" : "comes"} from the search's summary of the sources, not from text we could read on the page, so check ${many ? "them" : "it"} before relying on ${many ? "them" : "it"}.`;
}

/**
 * The _comments cell, in plain words: why the row's researched fields are
 * blank, and which filled ones rest only on the search's summary. Empty when
 * there is nothing to say. A row with every field blank is explained once,
 * since the likely cause is the row itself, not the fields.
 */
export function commentsCell(fields: string[], evidence: Evidence, row: CommentRow): string {
  if (row.status === "failed") return "Couldn't be researched (see _status). Re-running the job may fill it.";

  const researched = fields.filter((f) => evidence[f]);
  const blank = researched.filter((f) => evidence[f]?.quotes.length === 0);
  const fromSummary = researched.filter((f) => evidence[f]?.quotes.some((q) => q.origin === "search"));

  if (researched.length > 1 && blank.length === researched.length) {
    return `No source stated any of the fields for ${row.key}. Check that the name is spelled right and is what this sheet describes, or add a context column to help find it.`;
  }

  const byReason = new Map<BlankReason, string[]>();
  for (const field of blank) {
    const reason = evidence[field]?.blank ?? "not_found";
    byReason.set(reason, [...(byReason.get(reason) ?? []), field]);
  }
  return [
    ...[...byReason].map(([reason, names]) => reasonSentence(reason, names, row.key, row.sources.length)),
    ...(fromSummary.length > 0 ? [summarySentence(fromSummary)] : []),
  ].join(" ");
}

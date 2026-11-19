import { ROW_CAPS } from "@engine/contracts/job-status";

/** Validation retries after the first extraction attempt. */
export const MAX_RETRIES = 2;
/** Rows processed by a free preview job (source of truth: contracts). */
export const PREVIEW_ROWS = ROW_CAPS.preview;
/** Row cap for a full job on the free demo (source of truth: contracts). */
export const FULL_ROWS_FREE = ROW_CAPS.full;
/** Max sources kept per search (ranked best first; claims backed only by dropped sources are dropped). */
export const MAX_SOURCES = 8;
/** Max sources stored per row when several searches are merged. */
export const MAX_ROW_SOURCES = 16;
/** Fields covered by one search (lists get their own when there are 2+). */
export const FIELDS_PER_SEARCH = 10;
/**
 * Quotes one value (or list item) may cite. One states a plain fact; a value
 * written from several claims (a summary, a description) needs a few.
 */
export const MAX_QUOTES_PER_VALUE = 3;
/** Max grounded searches per row (before the one retry each). */
export const MAX_SEARCHES_PER_ROW = 2;
/**
 * Web queries one grounded search is asked to stay within. Queries are billed
 * per query and are most of a row's cost; it is a prompt instruction, so the
 * model can occasionally exceed it.
 */
export const MAX_QUERIES_PER_SEARCH = 2;
/**
 * Pages read directly per row (official, authority and reference sources),
 * whose own text extraction quotes. Fetched in parallel; no LLM cost.
 */
export const MAX_PAGES_PER_ROW = 4;
/** Page text kept per page (characters), most relevant passages first. */
export const MAX_PAGE_CHARS = 8000;

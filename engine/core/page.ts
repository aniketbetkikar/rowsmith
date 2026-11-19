/**
 * Reads a web page ourselves (no LLM): the final URL after redirects and the
 * raw body, size-capped. Used to prove facts a search can't state as a
 * sentence, such as which site is the entity's own and what it links to.
 */

/**
 * `body` is the text of an HTML/JSON/text page; a PDF comes as `pdf` bytes
 * (and an empty body), whole or not at all, since a cut PDF can't be read.
 */
export type Page = { url: string; body: string; pdf?: Uint8Array };

export type FetchLike = typeof fetch;

const TIMEOUT_MS = 6000;
const MAX_BYTES = 3_000_000;
const PDF_TIMEOUT_MS = 20_000;
const MAX_PDF_BYTES = 30_000_000;

// A generic client name: no user or project details leave the worker.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; RowsmithBot/1.0)",
  Accept: "text/html,application/xhtml+xml,application/pdf,application/json;q=0.9,*/*;q=0.5",
  "Accept-Language": "en",
};

/** The body's bytes up to `maxBytes`; `complete` is false when it was cut. */
async function readBytes(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; complete: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), complete: true };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= maxBytes) {
      await reader.cancel();
      return { bytes: concat(chunks, maxBytes), complete: false };
    }
  }
  return { bytes: concat(chunks, size), complete: true };
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.max(0, size - at));
    out.set(part, at);
    at += part.byteLength;
    if (at >= size) break;
  }
  return out;
}

const isPdf = (url: string, contentType: string) =>
  /application\/pdf/i.test(contentType) || (/\.pdf(?:$|[?#])/i.test(url) && !/html/i.test(contentType));

/** What a fetch came to: a page, an HTTP error status, or a network failure. */
export type FetchOutcome =
  | { kind: "page"; page: Page }
  | { kind: "status"; status: number }
  | { kind: "network"; unresolved: boolean };

export async function fetchOutcome(
  url: string,
  fetchImpl: FetchLike = fetch,
  { timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {},
): Promise<FetchOutcome> {
  try {
    const pdfLike = /\.pdf(?:$|[?#])/i.test(url);
    const res = await fetchImpl(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(pdfLike ? Math.max(timeoutMs, PDF_TIMEOUT_MS) : timeoutMs),
    });
    if (!res.ok) return { kind: "status", status: res.status };
    const finalUrl = res.url || url;
    const contentType = res.headers.get("content-type") ?? "";
    if (isPdf(finalUrl, contentType)) {
      const { bytes, complete } = await readBytes(res, MAX_PDF_BYTES);
      return complete ? { kind: "page", page: { url: finalUrl, body: "", pdf: bytes } } : { kind: "status", status: 413 };
    }
    const { bytes } = await readBytes(res, maxBytes);
    return { kind: "page", page: { url: finalUrl, body: new TextDecoder().decode(bytes) } };
  } catch (err) {
    const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
    return { kind: "network", unresolved: code === "ENOTFOUND" || code === "EAI_AGAIN" };
  }
}

/** The page, or null on any network error, timeout or non-2xx status. */
export async function fetchPage(
  url: string,
  fetchImpl: FetchLike = fetch,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Page | null> {
  const outcome = await fetchOutcome(url, fetchImpl, options);
  return outcome.kind === "page" ? outcome.page : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  const value = m?.[2] ?? m?.[3] ?? m?.[4];
  return value === undefined ? null : decodeEntities(value).trim();
}

/** The names a page gives itself: <title>, og:site_name, og:title, application-name. */
export function pageNames(html: string): string[] {
  const names: string[] = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) names.push(decodeEntities(title).replace(/\s+/g, " ").trim());
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (key === "og:site_name" || key === "og:title" || key === "application-name") {
      const content = attr(tag, "content");
      if (content) names.push(content);
    }
  }
  return names.filter(Boolean);
}

/** Absolute http(s) URLs of every <a href> on the page, deduped, in page order. */
export function pageLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, "href");
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") out.add(url.toString());
    } catch {
      // not a URL
    }
  }
  return [...out];
}

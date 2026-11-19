import { decodeEntities } from "./page";

/**
 * HTML → short passages of the page's own text (no LLM). Passages become
 * claims that extraction quotes word for word, so they must be the page's
 * words: tags are removed, nothing is rephrased.
 *
 * - An infobox (a key/value table, as on Wikipedia) becomes "Label: value"
 *   rows, the densest facts on such pages.
 * - Body text is split at block elements, and long paragraphs into sentences.
 * - Scripts, styles, navigation, footers and footnote markers are dropped.
 */

const MIN_CHARS = 20;
const MAX_CHARS = 500;

const DROP_ELEMENTS = ["script", "style", "noscript", "svg", "template", "head", "nav", "footer", "aside", "form", "button", "select"];

const OPEN_TAG = /<([a-zA-Z][\w-]*)((?:\s+[\w:.@-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

/**
 * Tags with only their class kept. Other attributes can hold markup with
 * ">" inside (Wikipedia's data-mw JSON), which would leak into the text.
 */
function stripAttributes(html: string): string {
  return html.replace(OPEN_TAG, (_, name: string, attrs: string, slash: string) => {
    const cls = /\sclass\s*=\s*("[^"]*"|'[^']*')/i.exec(attrs)?.[1];
    return `<${name}${cls ? ` class=${cls}` : ""}${slash}>`;
  });
}

function dropElements(html: string): string {
  let out = stripAttributes(html.replace(/<!--[\s\S]*?-->/g, " "));
  for (const tag of DROP_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), " ");
  }
  // Footnote markers ([1], [a]) live in <sup>.
  return out.replace(/<sup\b[\s\S]*?<\/sup>/gi, "");
}

/** Text of an HTML fragment with list items and line breaks as "; ". */
function inlineText(html: string): string {
  return clean(
    decodeEntities(
      html
        .replace(/<(br|\/li|\/p|\/div)\b[^>]*>/gi, "; ")
        .replace(/<[^>]+>/g, " "),
    ),
  ).replace(/^[;\s]+|[;\s]+$/g, "").replace(/(\s*;\s*)+/g, "; ");
}

function clean(text: string): string {
  return text
    .replace(/\[(?:\d+|[a-z]|citation needed|note \d+)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const INFOBOX = /<table\b[^>]*class="[^"]*\binfobox\b[^"]*"[^>]*>([\s\S]*?)<\/table>/i;

/** "Label: value" rows of the page's infobox, if it has one. */
export function infoboxRows(html: string): string[] {
  const box = INFOBOX.exec(dropElements(html))?.[1];
  if (!box) return [];
  const rows: string[] = [];
  for (const [, row = ""] of box.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const label = /<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(row)?.[1];
    const value = /<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(row)?.[1];
    if (!label || !value) continue;
    const l = inlineText(label);
    const v = inlineText(value);
    if (l && v) rows.push(`${l}: ${v}`.slice(0, MAX_CHARS));
  }
  return rows;
}

/** Long text split into sentences (a sentence ends with . ! or ? before a capital or digit). */
/** Running text (e.g. a PDF page) as sentence passages, short ones dropped. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=["“(]?[\p{Lu}\d])/u)
    .map((s) => clean(s).slice(0, MAX_CHARS))
    .filter((s) => s.length >= MIN_CHARS);
}

function sentences(line: string): string[] {
  if (line.length <= MAX_CHARS) return [line];
  return line
    .split(/(?<=[.!?])\s+(?=["“(]?[\p{Lu}\d])/u)
    .flatMap((s) => (s.length <= MAX_CHARS ? [s] : [s.slice(0, MAX_CHARS)]));
}

/** The page's body text as passages, infobox excluded, in page order, deduped. */
export function bodyPassages(html: string): string[] {
  let body = dropElements(html).replace(INFOBOX, " ");
  // Prefer the main content when the page marks it.
  const main = /<(main|article)\b[^>]*>([\s\S]*)<\/\1>/i.exec(body)?.[2];
  if (main && main.length > 2000) body = main;

  const text = decodeEntities(
    body
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<(br|\/?p|\/?div|\/?li|\/?h[1-6]|\/?tr|\/?table|\/?section|\/?ul|\/?ol|\/?dd|\/?dt|\/?blockquote|\/?header)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = clean(raw).replace(/(\s*\|\s*)+$/, "").replace(/^(\s*\|\s*)+/, "");
    for (const passage of sentences(line)) {
      if (passage.length < MIN_CHARS || seen.has(passage)) continue;
      seen.add(passage);
      out.push(passage);
    }
  }
  return out;
}

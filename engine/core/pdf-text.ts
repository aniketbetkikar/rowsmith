import { getDocumentProxy } from "unpdf";
import { splitSentences } from "./page-text";

/**
 * PDF → passages of its own text (no LLM), for reports, spec sheets, fact
 * sheets and the like. PDF text comes in visual lines, so each page is
 * joined into one text and split into sentences.
 */

/** Pages read per PDF: such documents state their key facts early. */
const MAX_PDF_PAGES = 120;

type TextPiece = { str?: unknown; hasEOL?: unknown };

function pieceText(item: unknown): string {
  const piece = item as TextPiece;
  return typeof piece.str === "string" ? piece.str + (piece.hasEOL === true ? "\n" : "") : "";
}

/** Passages of the PDF's text in page order, deduped; [] if it can't be read. */
export async function pdfPassages(bytes: Uint8Array): Promise<string[]> {
  try {
    // verbosity 0: no font warnings on the console.
    const doc = await getDocumentProxy(bytes, { verbosity: 0 });
    const seen = new Set<string>();
    const out: string[] = [];
    try {
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        const text = content.items.map(pieceText).join("").replace(/-\n(?=\p{Ll})/gu, "").replace(/\s+/g, " ").trim();
        for (const passage of splitSentences(text)) {
          if (seen.has(passage)) continue;
          seen.add(passage);
          out.push(passage);
        }
      }
    } finally {
      await doc.cleanup();
    }
    return out;
  } catch {
    return [];
  }
}

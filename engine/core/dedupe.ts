// Company-style suffixes dropped from the end of a key (after punctuation
// is stripped). Multi-word suffixes first so "private limited" wins.
const SUFFIXES = ["private limited", "inc", "ltd", "llc", "pvt", "co"];

/**
 * Normalises a key for duplicate detection: Unicode-normalise (and drop
 * accents), lowercase, strip punctuation, collapse spaces and remove
 * trailing company suffixes. A key that is only a suffix is kept as is.
 */
export function normalizeKey(raw: string): string {
  let key = raw
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of SUFFIXES) {
      if (key.endsWith(` ${suffix}`)) {
        key = key.slice(0, -(suffix.length + 1)).trimEnd();
        stripped = true;
      }
    }
  }
  return key;
}

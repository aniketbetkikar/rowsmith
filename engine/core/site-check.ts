import type { SiteStatus } from "@engine/contracts/job-config";
import { fetchOutcome, type FetchLike } from "./page";
import { bodyPassages } from "./page-text";

/**
 * Checks once, when the source plan is made, whether we can read a site:
 * its homepage (or www. homepage) loads as text we can quote → readable; it
 * answers but blocks us, needs a login or renders its text by script →
 * search_only (search may still use it); it doesn't exist → dead (dropped).
 */

export type SiteCheck = SiteStatus | "dead";

/** Readable text a homepage needs before we count the site as readable. */
const MIN_TEXT_CHARS = 300;
const CONCURRENCY = 16;

async function checkUrl(url: string, fetchImpl: FetchLike): Promise<SiteCheck> {
  const outcome = await fetchOutcome(url, fetchImpl);
  if (outcome.kind === "network") return outcome.unresolved ? "dead" : "search_only";
  if (outcome.kind === "status") return "search_only";
  const text = bodyPassages(outcome.page.body).join(" ");
  return text.length >= MIN_TEXT_CHARS ? "readable" : "search_only";
}

export async function checkSite(host: string, fetchImpl: FetchLike = fetch): Promise<SiteCheck> {
  const bare = await checkUrl(`https://${host}/`, fetchImpl);
  if (bare === "readable") return bare;
  const www = await checkUrl(`https://www.${host}/`, fetchImpl);
  if (www === "readable") return www;
  return bare === "dead" && www === "dead" ? "dead" : "search_only";
}

/** Each host's check, a few at a time. */
export async function checkSites(hosts: string[], fetchImpl: FetchLike = fetch): Promise<Map<string, SiteCheck>> {
  const out = new Map<string, SiteCheck>();
  const queue = [...new Set(hosts)];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let host = queue.shift(); host !== undefined; host = queue.shift()) {
        out.set(host, await checkSite(host, fetchImpl));
      }
    }),
  );
  return out;
}

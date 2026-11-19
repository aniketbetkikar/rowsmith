import { assertEnv } from "@/lib/env";

/** Runs once when the Next.js server starts: fail fast on a bad environment. */
export function register(): void {
  assertEnv();
}

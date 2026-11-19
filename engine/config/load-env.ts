import { existsSync } from "node:fs";

/**
 * Loads `.env.local` then `.env` into process.env for standalone entry
 * points (worker, eval, scripts). Next.js loads these itself, so the app
 * never imports this file (it would make Next trace the whole project).
 * Variables that are already set are never overridden, matching Next.js.
 */
export function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

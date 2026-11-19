// Time-saved estimate: researched cells × minutes a person would spend on each
// getting the same value out of ChatGPT or Claude (prompting, re-prompting,
// checking sources, fixing made-up values, copying into the sheet).

// The minutes per field comes from env (DEFAULT_MINUTES_PER_FIELD).
export const MAX_MINUTES_PER_FIELD = 60;

export function minutesSaved(filledCells: number, minutesPerField: number): number {
  return filledCells * minutesPerField;
}

/** "~2.6 hours", "~45 min": the estimate is rounded, so it says so. */
export function formatEstimate(minutes: number): string {
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `~${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** The per-field assumption: "30 sec", "2 min". */
export function formatPerField(minutes: number): string {
  return minutes < 1 ? `${Math.round(minutes * 60)} sec` : `${minutes} min`;
}

/** A measured duration: "45 seconds", "4 minutes", "1 hr 5 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} hr ${rest} min` : `${minutes / 60} hr`;
}

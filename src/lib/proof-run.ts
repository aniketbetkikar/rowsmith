import { formatEstimate, minutesSaved } from "./time-saved";

/**
 * A real, measured run shown on the landing page (25 companies, Nov 2026).
 * Update these when you re-measure.
 */
export const PROOF_RUN = {
  companies: 25,
  /** Cells Rowsmith researched and filled (same count as the job page). */
  filledCells: 314,
  /** Researched cells left blank because no source stated the value. */
  blankCells: 55,
  seconds: 540,
  costUsd: 1.69,
};

/** The run's research-time estimate at the given minutes per field, e.g. "~2.6 hours". */
export function proofRunSaved(minutesPerField: number): string {
  return formatEstimate(minutesSaved(PROOF_RUN.filledCells, minutesPerField));
}

/** Average cost per row of the run. */
export function proofRunPerRow(): number {
  return PROOF_RUN.costUsd / PROOF_RUN.companies;
}

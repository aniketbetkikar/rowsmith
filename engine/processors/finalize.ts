import type { ObjectId } from "mongodb";
import { completeJob } from "@engine/db/jobs";
import { copyToDuplicates } from "@engine/db/rows";
import { logger } from "@engine/utils/logger";

/**
 * Fills duplicate rows from their originals (no extra cost), then marks the
 * job completed. The status update is conditional, so it happens once.
 */
export async function finalizeJob(jobId: ObjectId): Promise<void> {
  const copied = await copyToDuplicates(jobId);
  if (await completeJob(jobId)) {
    logger.info({ jobId: jobId.toHexString(), duplicatesFilled: copied }, "job completed");
  }
}

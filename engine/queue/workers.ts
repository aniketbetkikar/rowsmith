import { UnrecoverableError, Worker, type Job } from "bullmq";
import { QUEUE_NAMES } from "@engine/contracts/queue-names";
import { getWorkerEnv } from "@engine/config/env";
import { onFinalFailure, processEnrich } from "@engine/processors/enrich";
import { onPrepareFailure, processPrepare } from "@engine/processors/prepare";
import { errorMessage } from "@engine/utils/errors";
import { logger } from "@engine/utils/logger";
import { getRedis } from "./connection";

/** Inside the processor: will BullMQ give up if this attempt throws? */
function isLastAttempt(job: Job, err: unknown): boolean {
  return err instanceof UnrecoverableError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

/** In a "failed" listener (attemptsMade already includes this failure). */
function hasFailedFinally(job: Job, err: Error): boolean {
  return err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
}

function logFailure(queue: string, job: Job | undefined, err: Error) {
  logger.warn(
    { queue, jobId: job?.id, attemptsMade: job?.attemptsMade, err: errorMessage(err) },
    "job attempt failed",
  );
}

/**
 * Starts the prepare and enrich workers. Final failures are handled inside
 * the processor (so a crash mid-handling is retried) and again in the
 * "failed" listener, which also covers jobs that exceeded the stall limit.
 * Both paths are idempotent.
 */
export function startWorkers(): Worker[] {
  const connection = getRedis();
  const { ENRICH_CONCURRENCY, RATE_MAX } = getWorkerEnv();

  const prepare = new Worker<unknown, void>(
    QUEUE_NAMES.prepare,
    async (job) => {
      try {
        await processPrepare(job.data);
      } catch (err) {
        if (isLastAttempt(job, err)) await onPrepareFailure(job.data, err);
        throw err;
      }
    },
    { connection, concurrency: 2 },
  );

  const enrich = new Worker<unknown, void>(
    QUEUE_NAMES.enrich,
    async (job) => {
      try {
        await processEnrich(job.data);
      } catch (err) {
        if (isLastAttempt(job, err)) await onFinalFailure(job.data, err);
        throw err;
      }
    },
    {
      connection,
      concurrency: ENRICH_CONCURRENCY,
      limiter: { max: RATE_MAX, duration: 1000 },
    },
  );

  prepare.on("failed", (job, err) => {
    logFailure(QUEUE_NAMES.prepare, job, err);
    if (job && hasFailedFinally(job, err)) {
      onPrepareFailure(job.data, err).catch((e: unknown) =>
        logger.error({ err: errorMessage(e) }, "prepare final-failure handling failed"),
      );
    }
  });

  enrich.on("failed", (job, err) => {
    logFailure(QUEUE_NAMES.enrich, job, err);
    if (job && hasFailedFinally(job, err)) {
      onFinalFailure(job.data, err).catch((e: unknown) =>
        logger.error({ err: errorMessage(e) }, "enrich final-failure handling failed"),
      );
    }
  });

  for (const worker of [prepare, enrich]) {
    worker.on("error", (err) => logger.error({ queue: worker.name, err: errorMessage(err) }, "worker error"));
  }

  return [prepare, enrich];
}

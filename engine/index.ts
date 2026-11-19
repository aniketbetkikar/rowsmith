import { getEnv, getLogLevel } from "@engine/config/env";
import { loadEnvFiles } from "@engine/config/load-env";
import { closeDb, ensureIndexes } from "@engine/db/client";
import { assertModels, formatChains, modelNames, onModelFallback } from "@engine/llm/models";
import { closeRedis } from "@engine/queue/connection";
import { closeQueues } from "@engine/queue/queues";
import { startWorkers } from "@engine/queue/workers";
import { errorMessage } from "@engine/utils/errors";
import { logger } from "@engine/utils/logger";

async function main(): Promise<void> {
  // 1. Env (fails fast on anything missing or invalid).
  loadEnvFiles();
  const env = getEnv();
  logger.level = getLogLevel();

  // 2. Every role's model must be in the catalogue (price + thinking levels).
  assertModels();
  onModelFallback(({ role, from, to, error }) =>
    logger.warn({ role, from, to, err: errorMessage(error) }, "model overloaded, falling back"),
  );

  // 3. Indexes, then 4. workers.
  await ensureIndexes();
  const workers = startWorkers();
  logger.info(
    { concurrency: env.ENRICH_CONCURRENCY, rateMax: env.RATE_MAX, models: modelNames(), chains: formatChains() },
    "worker started",
  );

  // 5. Graceful shutdown: let active jobs finish, then close connections.
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    try {
      await Promise.all(workers.map((w) => w.close()));
      await closeQueues();
      await closeRedis();
      await closeDb();
      process.exit(0);
    } catch (err) {
      logger.error({ err: errorMessage(err) }, "shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.fatal({ err: errorMessage(err) }, "worker failed to start");
  process.exit(1);
});

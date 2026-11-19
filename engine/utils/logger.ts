import pino from "pino";
import pretty from "pino-pretty";
import { getLogLevel, isProduction } from "@engine/config/env";

// JSON logs in production; pretty, synchronous output in development
// (a stream, not a transport, so no worker threads are spawned).
export const logger = isProduction()
  ? pino({ level: getLogLevel(), base: { service: "rowsmith" } })
  : pino({ level: getLogLevel() }, pretty({ colorize: true, sync: true }));

export type Logger = typeof logger;

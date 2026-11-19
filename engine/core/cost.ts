import {
  MODEL_CATALOG,
  modelInfo,
  priceOn,
  SEARCH_PRICE_PER_CALL,
  type ModelInfo,
} from "@engine/llm/models";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

type Catalog = Record<string, ModelInfo>;

/**
 * USD cost of one call's tokens at the price on `at` (announced changes
 * included). Cached input is billed at the cached rate. Throws a
 * ConfigError for a model missing from the catalogue.
 */
export function tokenCost(
  model: string,
  usage: TokenUsage,
  catalog: Catalog = MODEL_CATALOG,
  at: Date = new Date(),
): number {
  const price = priceOn(modelInfo(model, catalog), at);
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  return (
    ((usage.inputTokens - cached) * price.input +
      cached * price.cachedInput +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

export function searchCost(
  searchCalls: number,
  pricePerCall: number = SEARCH_PRICE_PER_CALL,
): number {
  return searchCalls * pricePerCall;
}

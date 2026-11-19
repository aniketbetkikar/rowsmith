import { ThinkingLevel as GenAIThinkingLevel, type ThinkingConfig } from "@google/genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI, type GoogleGenerativeAIChatInput } from "@langchain/google-genai";
import { getLlmEnv, type LlmEnv } from "@engine/config/env";
import { ConfigError, isOverloaded } from "@engine/utils/errors";

/**
 * In-SDK retries for a single API call (quick blips). Anything still failing
 * is thrown, classified by isTransient(), and retried by BullMQ with backoff.
 */
export const SDK_MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Catalogue: every model a role may use, with its price and thinking levels.
// ---------------------------------------------------------------------------

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";
const LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high"];

/** USD per 1M tokens. */
export type ModelPrice = {
  input: number;
  cachedInput: number;
  output: number;
};

export type ModelInfo = {
  price: ModelPrice;
  /** Announced price changes, oldest first; each applies from its UTC date. */
  changes?: { from: string; price: ModelPrice }[];
  thinking: { default: ThinkingLevel; levels: readonly ThinkingLevel[] };
};

// Gemini Developer API, paid tier (Standard), text input. Output prices
// include thinking tokens. Update both when Google's pages change.
// Prices:   https://ai.google.dev/gemini-api/docs/pricing  (last updated 2026-10-28)
// Thinking: https://ai.google.dev/gemini-api/docs/thinking (last updated 2026-10-14)
// Only Gemini 3+ models: they bill grounding per search query (below);
// 2.5 models bill per grounded prompt, which searchCost doesn't model.
export const MODEL_CATALOG: Record<string, ModelInfo> = {
  "gemini-4-argon": {
    price: { input: 2, cachedInput: 0.1, output: 10 },
    changes: [{ from: "2026-12-01", price: { input: 4, cachedInput: 0.2, output: 20 } }],
    thinking: { default: "medium", levels: ["low", "medium", "high"] },
  },
  // Pro prices are for prompts ≤ 200k tokens (ours are far smaller).
  "gemini-3.1-pro-preview": {
    price: { input: 2, cachedInput: 0.2, output: 12 },
    thinking: { default: "high", levels: ["low", "medium", "high"] },
  },
  "gemini-3.8-flash": {
    price: { input: 0.75, cachedInput: 0.075, output: 3.75 },
    changes: [{ from: "2027-01-01", price: { input: 1.5, cachedInput: 0.15, output: 7.5 } }],
    thinking: { default: "medium", levels: ["low", "medium", "high"] },
  },
  "gemini-3.6-flash": {
    price: { input: 0.75, cachedInput: 0.075, output: 3.75 },
    changes: [{ from: "2027-01-01", price: { input: 1.5, cachedInput: 0.15, output: 7.5 } }],
    thinking: { default: "medium", levels: ["minimal", "low", "medium", "high"] },
  },
  "gemini-3.5-flash-lite": {
    price: { input: 0.3, cachedInput: 0.03, output: 2.5 },
    thinking: { default: "minimal", levels: ["minimal", "low", "medium", "high"] },
  },
  // Extract fallback. Price from the pricing page (read 2026-11-06). The
  // thinking page has no row for it: levels and default were probed live on
  // 2026-11-06 (all four accepted; the default used 0 thinking tokens, as
  // "minimal" did).
  "gemini-3.1-flash-lite": {
    price: { input: 0.25, cachedInput: 0.025, output: 1.5 },
    thinking: { default: "minimal", levels: ["minimal", "low", "medium", "high"] },
  },
};

/**
 * Grounding with Google Search on Gemini 3+: $14 per 1,000 search queries
 * (each query the model runs counts). The first 5,000 per month are free;
 * we cost every query at the paid rate so per-row costs stay comparable.
 */
export const SEARCH_PRICE_PER_CALL = 14 / 1000;

/** The model's price on a given day (announced changes included). */
export function priceOn(info: ModelInfo, at: Date): ModelPrice {
  const day = at.toISOString().slice(0, 10);
  let price = info.price;
  for (const change of info.changes ?? []) if (day >= change.from) price = change.price;
  return price;
}

export function modelInfo(model: string, catalog: Record<string, ModelInfo> = MODEL_CATALOG): ModelInfo {
  const info = catalog[model];
  if (!info) {
    throw new ConfigError(`Model "${model}" is not in the catalogue. Add it to engine/llm/models.ts.`);
  }
  return info;
}

// ---------------------------------------------------------------------------
// Roles: which env var picks the model, and how much thinking the job needs.
// ---------------------------------------------------------------------------

type FallbackEnvKey = Extract<keyof LlmEnv, `MODEL_${string}_FALLBACKS`>;
type ModelEnvKey = Exclude<Extract<keyof LlmEnv, `MODEL_${string}`>, FallbackEnvKey>;

const ROLES = {
  // Picks queries and writes notes; the grounding tool does the reading.
  search: { env: "MODEL_SEARCH", fallbacks: "MODEL_SEARCH_FALLBACKS", thinking: "low" },
  // Copies values and quotes from the notes (the quote check catches mistakes).
  extract: { env: "MODEL_EXTRACT", fallbacks: "MODEL_EXTRACT_FALLBACKS", thinking: "minimal" },
  // Last extraction retry, after the cheap model failed validation twice.
  rescue: { env: "MODEL_VERIFY", fallbacks: "MODEL_VERIFY_FALLBACKS", thinking: "low" },
  // The accuracy gate: right entity, scope, unit, current vs former state.
  verify: { env: "MODEL_VERIFY", fallbacks: "MODEL_VERIFY_FALLBACKS", thinking: "medium" },
  // Once per job, while the user waits: a fast model at low thinking.
  suggest: { env: "MODEL_SUGGEST", fallbacks: "MODEL_SUGGEST_FALLBACKS", thinking: "low" },
  // Evals only: grades the engine, so stronger than the search model.
  judge: { env: "MODEL_JUDGE", fallbacks: null, thinking: "medium" },
} as const satisfies Record<
  string,
  { env: ModelEnvKey; fallbacks: FallbackEnvKey | null; thinking: ThinkingLevel }
>;

export type ModelRole = keyof typeof ROLES;
export const MODEL_ROLES = Object.keys(ROLES) as ModelRole[];

export type ModelChoice = { model: string; thinking: ThinkingLevel };

/** The wanted level if the model has it, else the nearest one above (or its highest). */
function supportedLevel(wanted: ThinkingLevel, levels: readonly ThinkingLevel[]): ThinkingLevel {
  const rank = LEVELS.indexOf(wanted);
  return levels.find((l) => LEVELS.indexOf(l) >= rank) ?? levels[levels.length - 1] ?? wanted;
}

function choiceFor(role: ModelRole, model: string): ModelChoice {
  const info = modelInfo(model);
  return { model, thinking: supportedLevel(ROLES[role].thinking, info.thinking.levels) };
}

/** The model and thinking level for a role. Throws ConfigError for an unknown model. */
export function modelFor(role: ModelRole): ModelChoice {
  return choiceFor(role, getLlmEnv()[ROLES[role].env]);
}

/** The role's model, then its fallbacks in order (duplicates dropped). */
export function modelChain(role: ModelRole): ModelChoice[] {
  const env = getLlmEnv();
  const key = ROLES[role].fallbacks;
  const names = [env[ROLES[role].env], ...(key ? env[key] : [])];
  return [...new Set(names)].map((model) => choiceFor(role, model));
}

export type FallbackEvent = { role: ModelRole; from: string; to: string; error: unknown };

let fallbackListener: (event: FallbackEvent) => void = () => {};

/** Entry points (worker, scripts) register a logger here; core stays log-free. */
export function onModelFallback(listener: (event: FallbackEvent) => void): void {
  fallbackListener = listener;
}

/**
 * Runs `call` on the role's model; on a 503 (overloaded) moves straight to
 * the next model in the chain instead of retrying the saturated one. Every
 * model but the last runs with no SDK retries, so the switch is instant; the
 * last keeps SDK_MAX_RETRIES. Other errors, and a 503 from the last model,
 * are thrown (BullMQ then backs off and retries the whole job).
 */
export async function withFallback<T>(
  role: ModelRole,
  call: (choice: ModelChoice, retries: number) => Promise<T>,
): Promise<T> {
  const chain = modelChain(role);
  for (const [i, choice] of chain.entries()) {
    const next = chain[i + 1];
    try {
      return await call(choice, next ? 0 : SDK_MAX_RETRIES);
    } catch (err) {
      if (!next || !isOverloaded(err)) throw err;
      fallbackListener({ role, from: choice.model, to: next.model, error: err });
    }
  }
  throw new ConfigError(`No model configured for role "${role}".`);
}

/** Model name per role. Used for logging and eval reports. */
export function modelNames(): Record<ModelRole, string> {
  return Object.fromEntries(MODEL_ROLES.map((role) => [role, modelFor(role).model])) as Record<ModelRole, string>;
}

/** "search=… extract=…" for log lines. */
export function formatModels(names: Record<ModelRole, string>): string {
  return Object.entries(names).map(([role, model]) => `${role}=${model}`).join(" ");
}

/** "search=a>b>c …" for log lines: each role's full fallback chain. */
export function formatChains(): string {
  return MODEL_ROLES.map((role) => `${role}=${modelChain(role).map((c) => c.model).join(">")}`).join(" ");
}

/** Throws at boot if any role's model or fallback is missing from the catalogue. */
export function assertModels(): void {
  for (const role of MODEL_ROLES) modelChain(role);
}

/** Thinking is sent only when it differs from the model's default. */
function thinkingOverride({ model, thinking }: ModelChoice): ThinkingLevel | undefined {
  return modelInfo(model).thinking.default === thinking ? undefined : thinking;
}

// ---------------------------------------------------------------------------
// Clients. Swapping the provider later should mean changing only this file
// (and llm/gemini.ts for the grounded search client).
// ---------------------------------------------------------------------------

const GENAI_LEVELS: Record<ThinkingLevel, GenAIThinkingLevel> = {
  minimal: GenAIThinkingLevel.MINIMAL,
  low: GenAIThinkingLevel.LOW,
  medium: GenAIThinkingLevel.MEDIUM,
  high: GenAIThinkingLevel.HIGH,
};

/** Model and thinking config for a @google/genai generateContent call. */
export function genAIConfig(choice: ModelChoice): { model: string; thinkingConfig?: ThinkingConfig } {
  const level = thinkingOverride(choice);
  return level ? { model: choice.model, thinkingConfig: { thinkingLevel: GENAI_LEVELS[level] } } : { model: choice.model };
}

/** genAIConfig for the role's own model (no fallback). */
export function genAIModel(role: ModelRole): { model: string; thinkingConfig?: ThinkingConfig } {
  return genAIConfig(modelFor(role));
}

type LangChainLevel = NonNullable<NonNullable<GoogleGenerativeAIChatInput["thinkingConfig"]>["thinkingLevel"]>;

const chatModels = new Map<string, BaseChatModel>();

/** LangChain chat model for a model + thinking level + SDK retries, created on first use. */
export function chatModelFor(choice: ModelChoice, retries = SDK_MAX_RETRIES): BaseChatModel {
  const key = `${choice.model}|${choice.thinking}|${retries}`;
  const cached = chatModels.get(key);
  if (cached) return cached;
  const level = thinkingOverride(choice);
  const created = new ChatGoogleGenerativeAI({
    model: choice.model,
    apiKey: getLlmEnv().GEMINI_API_KEY,
    temperature: 0,
    maxRetries: retries,
    // LangChain's type omits "MINIMAL", which the API accepts.
    ...(level ? { thinkingConfig: { thinkingLevel: level.toUpperCase() as LangChainLevel } } : {}),
  });
  chatModels.set(key, created);
  return created;
}

/** LangChain chat model for the role's own model (no fallback). */
export function chatModel(role: ModelRole): BaseChatModel {
  return chatModelFor(modelFor(role));
}

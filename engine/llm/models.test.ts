import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = {
  GEMINI_API_KEY: "key",
  MODEL_SEARCH: "gemini-3.8-flash",
  MODEL_EXTRACT: "gemini-3.5-flash-lite",
  MODEL_VERIFY: "gemini-3.8-flash",
  MODEL_SUGGEST: "gemini-3.8-flash",
  MODEL_JUDGE: "gemini-4-argon",
  MODEL_SEARCH_FALLBACKS: "",
  MODEL_EXTRACT_FALLBACKS: "",
  MODEL_VERIFY_FALLBACKS: "",
  MODEL_SUGGEST_FALLBACKS: "",
};

// Env is memoised per module, so each test re-imports with fresh env.
async function load(overrides: Partial<typeof env> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...env, ...overrides })) vi.stubEnv(k, v);
  return import("./models");
}

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("modelFor", () => {
  it("gives each role its model and thinking level", async () => {
    const { modelFor } = await load();
    expect(modelFor("search")).toEqual({ model: "gemini-3.8-flash", thinking: "low" });
    expect(modelFor("extract")).toEqual({ model: "gemini-3.5-flash-lite", thinking: "minimal" });
    expect(modelFor("rescue")).toEqual({ model: "gemini-3.8-flash", thinking: "low" });
    expect(modelFor("verify")).toEqual({ model: "gemini-3.8-flash", thinking: "medium" });
    expect(modelFor("suggest")).toEqual({ model: "gemini-3.8-flash", thinking: "low" });
  });

  it("uses the nearest supported level above when the wanted one is missing", async () => {
    // 3.8 Flash has no "minimal", so extract on it runs at "low".
    const { modelFor } = await load({ MODEL_EXTRACT: "gemini-3.8-flash" });
    expect(modelFor("extract")).toEqual({ model: "gemini-3.8-flash", thinking: "low" });
  });

  it("throws a ConfigError for a model missing from the catalogue", async () => {
    const { assertModels } = await load({ MODEL_VERIFY: "gemini-9-unknown" });
    // resetModules loads a fresh ConfigError class, so match by name.
    expect(() => assertModels()).toThrow(
      expect.objectContaining({ name: "ConfigError", message: expect.stringMatching(/gemini-9-unknown/) }),
    );
  });
});

describe("genAIModel", () => {
  it("sends thinking only when it differs from the model's default", async () => {
    const { genAIModel } = await load({ MODEL_SEARCH: "gemini-3.5-flash-lite" });
    // Flash-Lite's default is "minimal"; search wants "low".
    expect(genAIModel("search")).toEqual({
      model: "gemini-3.5-flash-lite",
      thinkingConfig: { thinkingLevel: "LOW" },
    });
    expect(genAIModel("extract")).toEqual({ model: "gemini-3.5-flash-lite" });
  });
});

describe("MODEL_CATALOG", () => {
  it("lists a default thinking level the model supports", async () => {
    const { MODEL_CATALOG } = await load();
    for (const info of Object.values(MODEL_CATALOG)) {
      expect(info.thinking.levels).toContain(info.thinking.default);
    }
  });

  it("has announced price changes in date order", async () => {
    const { MODEL_CATALOG } = await load();
    for (const info of Object.values(MODEL_CATALOG)) {
      const dates = (info.changes ?? []).map((c) => c.from);
      expect(dates).toEqual([...dates].sort());
    }
  });
});

describe("withFallback", () => {
  const overloaded = () => Object.assign(new Error("model overloaded"), { status: 503 });

  it("chains the role's model and its fallbacks, with the role's thinking level", async () => {
    const { modelChain } = await load({ MODEL_EXTRACT_FALLBACKS: "gemini-3.1-flash-lite, gemini-3.8-flash" });
    expect(modelChain("extract")).toEqual([
      { model: "gemini-3.5-flash-lite", thinking: "minimal" },
      { model: "gemini-3.1-flash-lite", thinking: "minimal" },
      { model: "gemini-3.8-flash", thinking: "low" },
    ]);
    expect(modelChain("judge")).toEqual([{ model: "gemini-4-argon", thinking: "medium" }]);
  });

  it("moves to the next model on a 503, with no SDK retries until the last", async () => {
    const { withFallback, onModelFallback } = await load({ MODEL_SEARCH_FALLBACKS: "gemini-3.6-flash,gemini-4-argon" });
    const events: string[] = [];
    onModelFallback((e) => events.push(`${e.from}>${e.to}`));
    const calls: string[] = [];
    const result = await withFallback("search", async ({ model }, retries) => {
      calls.push(`${model}:${retries}`);
      if (model !== "gemini-4-argon") throw overloaded();
      return model;
    });
    expect(result).toBe("gemini-4-argon");
    expect(calls).toEqual(["gemini-3.8-flash:0", "gemini-3.6-flash:0", "gemini-4-argon:2"]);
    expect(events).toEqual(["gemini-3.8-flash>gemini-3.6-flash", "gemini-3.6-flash>gemini-4-argon"]);
  });

  it("throws other errors, and a 503 from the last model, without falling back", async () => {
    const { withFallback } = await load({ MODEL_SEARCH_FALLBACKS: "gemini-3.6-flash" });
    const bad = Object.assign(new Error("bad request"), { status: 400 });
    const call = vi.fn().mockRejectedValue(bad);
    await expect(withFallback("search", call)).rejects.toBe(bad);
    expect(call).toHaveBeenCalledTimes(1);

    const last = overloaded();
    await expect(withFallback("search", vi.fn().mockRejectedValueOnce(overloaded()).mockRejectedValue(last))).rejects.toBe(last);
  });

  it("rejects a fallback missing from the catalogue at boot", async () => {
    const { assertModels } = await load({ MODEL_VERIFY_FALLBACKS: "gemini-9-unknown" });
    expect(() => assertModels()).toThrow(expect.objectContaining({ name: "ConfigError" }));
  });
});

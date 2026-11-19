import { AIMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildRowSchema } from "./build-schema";
import { extractStructured, formatIssues, toModelJsonSchema } from "./extract";

const invoke = vi.fn();
const withStructuredOutput = vi.fn(() => ({ invoke }));

vi.mock("@engine/llm/models", () => ({
  withFallback: (_role: string, call: (choice: { model: string; thinking: string }, retries: number) => unknown) =>
    call({ model: "extract-model", thinking: "minimal" }, 2),
  chatModelFor: () => ({ withStructuredOutput }),
}));

const schema = buildRowSchema([
  { name: "summary", type: "text", description: "Short summary" },
  { name: "founded", type: "year", description: "Year founded" },
  { name: "website", type: "url", description: "Official site" },
  { name: "industry", type: "enum", description: "Industry", options: ["SaaS", "Fintech"] },
  { name: "products", type: "list", description: "Products", maxItems: 3 },
]);

function raw(usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 }) {
  return new AIMessage({
    content: "{}",
    usage_metadata: { ...usage, input_token_details: { cache_read: 30 } },
  });
}

describe("toModelJsonSchema", () => {
  const json = toModelJsonSchema(schema);
  const props = json.properties as Record<string, Record<string, unknown>>;

  it("produces an object with every key required, in a stable order", () => {
    const keys = ["summary", "founded", "website", "industry", "products"];
    expect(json.type).toBe("object");
    expect(json.required).toEqual(keys);
    expect(json.propertyOrdering).toEqual(keys);
    expect(json).not.toHaveProperty("$schema");
    expect(json).not.toHaveProperty("additionalProperties");
  });

  it("keeps descriptions, enums, numeric ranges and maxItems", () => {
    const serialized = JSON.stringify(json);
    expect(props.founded?.description).toBe("Year founded");
    expect(serialized).toContain('"enum":["SaaS","Fintech"]');
    expect(serialized).toContain('"minimum":1800');
    expect(serialized).toContain('"maxItems":3');
  });

  it("keeps string lengths Gemini supports and drops formats it does not (uri)", () => {
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('"minLength":1');
    expect(serialized).toContain('"maxLength":500');
    expect(serialized).not.toContain('"format":"uri"');
  });

  it("requires every key in nested objects too", () => {
    const nested = toModelJsonSchema(
      z.object({ items: z.array(z.object({ a: z.string(), b: z.number().optional() })) }),
    );
    const item = (nested.properties as { items: { items: Record<string, unknown> } }).items.items;
    expect(item.required).toEqual(["a", "b"]);
    expect(item.propertyOrdering).toEqual(["a", "b"]);
  });

  it("rewrites type arrays (which Gemini rejects) as nullable types", () => {
    const json = toModelJsonSchema(z.object({ n: z.number().nullable(), s: z.string().nullable() }));
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.n).toEqual({ type: "number", nullable: true });
    expect(props.s).toEqual({ type: "string", nullable: true });
    expect(JSON.stringify(json)).not.toMatch(/"type":\[/);
  });

  it("keeps user field names that collide with JSON Schema keywords", () => {
    const json = toModelJsonSchema(z.object({ format: z.string(), title: z.string() }));
    expect(Object.keys(json.properties as object)).toEqual(["format", "title"]);
  });
});

describe("formatIssues", () => {
  it("renders field: message lines", () => {
    const result = schema.safeParse({
      summary: "",
      founded: 1500,
      website: "notion.so",
      industry: "Retail",
      products: null,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = formatIssues(result.error);
    expect(issues).toHaveLength(4);
    expect(issues.map((i) => i.split(":")[0])).toEqual(["summary", "founded", "website", "industry"]);
  });
});

describe("extractStructured", () => {
  beforeEach(() => {
    invoke.mockReset();
    withStructuredOutput.mockClear();
  });

  const valid = {
    summary: "Workspace app",
    founded: 2013,
    website: "https://notion.so",
    industry: "SaaS",
    products: ["Docs"],
  };

  it("requests JSON-schema output with the raw message", async () => {
    invoke.mockResolvedValue({ raw: raw(), parsed: valid });
    await extractStructured("extract", schema, "prompt");
    expect(withStructuredOutput).toHaveBeenCalledWith(
      expect.objectContaining({ type: "object", required: expect.any(Array) }),
      expect.objectContaining({ method: "jsonSchema", includeRaw: true }),
    );
    expect(invoke).toHaveBeenCalledWith("prompt");
  });

  it("counts thinking tokens (in the total, not output_tokens) as output", async () => {
    invoke.mockResolvedValue({
      raw: raw({ input_tokens: 100, output_tokens: 20, total_tokens: 170 }),
      parsed: valid,
    });
    const { usage } = await extractStructured("extract", schema, "prompt");
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 70, cachedTokens: 30 });
  });

  it("returns validated data and usage from raw.usage_metadata", async () => {
    invoke.mockResolvedValue({ raw: raw(), parsed: valid });
    expect(await extractStructured("extract", schema, "prompt")).toEqual({
      parsed: valid,
      issues: [],
      usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 30 },
      model: "extract-model",
    });
  });

  it("returns issues instead of throwing when validation fails", async () => {
    invoke.mockResolvedValue({ raw: raw(), parsed: { ...valid, founded: 3000 } });
    const result = await extractStructured("extract", schema, "prompt");
    expect(result.parsed).toBeNull();
    expect(result.issues).toEqual([expect.stringMatching(/^founded: /)]);
    expect(result.usage.inputTokens).toBe(100);
  });

  it("reports unparseable output as an issue", async () => {
    invoke.mockResolvedValue({ raw: raw(), parsed: null });
    const result = await extractStructured("extract", schema, "prompt");
    expect(result.parsed).toBeNull();
    expect(result.issues).toHaveLength(1);
  });

  it("propagates API errors", async () => {
    invoke.mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 }));
    await expect(extractStructured("extract", schema, "prompt")).rejects.toThrow("rate limited");
  });
});

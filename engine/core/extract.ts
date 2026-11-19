import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { chatModelFor, withFallback, type ModelRole } from "@engine/llm/models";
import type { TokenUsage } from "./cost";

export type ExtractResult<T> = {
  parsed: T | null;
  issues: string[];
  usage: TokenUsage;
  model: string;
};

type JsonObject = { [key: string]: unknown };

// Keywords Gemini's response schema accepts. Anything else is dropped from
// what the model sees, but still enforced by our own Zod validation, which
// feeds failures back as issues.
const SCHEMA_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "propertyOrdering",
  "items",
  "enum",
  "anyOf",
  "nullable",
  "description",
  "title",
  "format",
  "pattern",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

// String formats Gemini understands (others, e.g. "uri", are dropped).
const SCHEMA_FORMATS = new Set(["date-time", "enum"]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeMap(map: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(map).map(([name, schema]) => [name, sanitize(schema)]),
  );
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!isObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (!SCHEMA_KEYWORDS.has(key)) continue;
    if (key === "format" && !(typeof value === "string" && SCHEMA_FORMATS.has(value))) {
      continue;
    }
    // Property maps are keyed by user field names, not keywords.
    out[key] = key === "properties" && isObject(value) ? sanitizeMap(value) : sanitize(value);
  }
  // Gemini rejects type arrays: ["number", "null"] → number + nullable.
  if (Array.isArray(out.type)) {
    const types = out.type.filter((t) => t !== "null");
    if (types.length < out.type.length) out.nullable = true;
    if (types.length === 1) {
      out.type = types[0];
    } else {
      delete out.type;
      out.anyOf = types.map((type) => ({ type }));
    }
  }
  // Every key must be present (null when unknown), in a stable order.
  if (isObject(out.properties)) {
    out.required = Object.keys(out.properties);
    out.propertyOrdering = Object.keys(out.properties);
  }
  return out;
}

/** Zod schema → JSON Schema in the subset Gemini structured output accepts. */
export function toModelJsonSchema(schema: z.ZodType): JsonObject {
  const json = sanitize(z.toJSONSchema(schema, { unrepresentable: "any" }));
  if (!isObject(json) || json.type !== "object") {
    throw new Error("Structured output schema must be an object.");
  }
  return json;
}

/** Zod error → short, readable "field: problem" lines for the retry prompt. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
}

/**
 * Billing-relevant usage from a LangChain message. LangChain's Gemini
 * output_tokens excludes thinking tokens, which are billed as output, so
 * output is derived from the total instead.
 */
export function usageFrom(raw: BaseMessage): TokenUsage {
  const meta = AIMessage.isInstance(raw) ? raw.usage_metadata : undefined;
  const input = meta?.input_tokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: Math.max(meta?.output_tokens ?? 0, (meta?.total_tokens ?? 0) - input),
    cachedTokens: meta?.input_token_details?.cache_read ?? 0,
  };
}

/**
 * One structured-output call with the role's model. Validation failures are
 * returned as `issues` (never thrown); API errors propagate to the caller.
 */
export async function extractStructured<T extends z.ZodType>(
  role: ModelRole,
  schema: T,
  prompt: string,
): Promise<ExtractResult<z.infer<T>>> {
  const jsonSchema = toModelJsonSchema(schema);
  const { model, raw, parsed } = await withFallback(role, async (choice, retries) => {
    const runnable = chatModelFor(choice, retries).withStructuredOutput<Record<string, unknown>>(
      jsonSchema,
      { name: "extract", method: "jsonSchema", includeRaw: true },
    );
    return { model: choice.model, ...(await runnable.invoke(prompt)) };
  });
  const usage = usageFrom(raw);

  if (parsed == null) {
    return {
      parsed: null,
      issues: ["(root): the response was not valid JSON for the schema"],
      usage,
      model,
    };
  }

  const result = schema.safeParse(parsed);
  return result.success
    ? { parsed: result.data, issues: [], usage, model }
    : { parsed: null, issues: formatIssues(result.error), usage, model };
}

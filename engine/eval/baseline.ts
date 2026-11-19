import { z } from "zod";
import type { JobConfig } from "@engine/contracts/job-config";
import { fieldList, type RowInput } from "@engine/core/build-prompt";
import { tokenCost } from "@engine/core/cost";
import { usageFrom } from "@engine/core/extract";
import { chatModel, modelFor } from "@engine/llm/models";

export type BaselineResult = {
  output: Record<string, unknown> | null;
  costUsd: number;
  error?: string;
};

const JsonObjectSchema = z.record(z.string(), z.unknown());

function baselinePrompt(config: JobConfig, row: RowInput): string {
  const context = config.contextColumns
    .map((c) => (row.input[c] ? `${c}: ${row.input[c]}` : null))
    .filter(Boolean)
    .join("; ");
  return [
    `Fill in these fields for ${row.key} (${config.entityDescription}).`,
    context ? `Context: ${context}.` : null,
    "",
    fieldList(config.fields),
    "",
    "Reply with only a JSON object with exactly these keys.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** First {...} block in the reply, parsed leniently (code fences allowed). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const result = JsonObjectSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * "Plain LLM" comparison: one call with the extract model, no web search,
 * no schema enforcement, no validation or retry.
 */
export async function baselineRow(
  config: JobConfig,
  row: RowInput,
): Promise<BaselineResult> {
  const message = await chatModel("extract").invoke(baselinePrompt(config, row));
  const costUsd = tokenCost(modelFor("extract").model, usageFrom(message));
  const output = parseJsonObject(message.text);
  return output
    ? { output, costUsd }
    : { output: null, costUsd, error: "Reply was not a JSON object" };
}

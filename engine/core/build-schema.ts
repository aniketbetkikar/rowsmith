import { z } from "zod";
import type { FieldDef } from "@engine/contracts/job-config";
import { MAX_QUOTES_PER_VALUE } from "@engine/config/limits";
import { ConfigError } from "@engine/utils/errors";

const YEAR_MIN_DEFAULT = 1800;
const LIST_MAX_DEFAULT = 5;
const TEXT_MAX = 500;

export type RowSchema = z.ZodObject<
  Record<string, z.ZodNullable<z.ZodType>>
>;
export type RowOutput = z.infer<RowSchema>;

function baseSchema(field: FieldDef): z.ZodType {
  switch (field.type) {
    case "text":
      return z.string().min(1).max(TEXT_MAX);
    case "number": {
      let schema = z.number();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case "year":
      return z
        .number()
        .int()
        .min(field.min ?? YEAR_MIN_DEFAULT)
        .max(field.max ?? new Date().getFullYear());
    case "url":
      return z.url({ protocol: /^https?$/ });
    case "enum":
      if (!field.options || field.options.length === 0) {
        throw new ConfigError(`Enum field "${field.name}" has no options.`);
      }
      return z.enum(field.options);
    case "list":
      return z.array(z.string()).max(field.maxItems ?? LIST_MAX_DEFAULT);
    case "boolean":
      return z.boolean();
  }
}

const quotes = () =>
  z
    .array(z.string().min(1).describe("Exact words copied from one claim in the notes"))
    .max(MAX_QUOTES_PER_VALUE)
    .describe(
      `The quotes that together state this value: one for a plain fact, up to ${MAX_QUOTES_PER_VALUE} for a value written from several claims`,
    );

/**
 * What the extraction model returns per field: the value plus the quotes that
 * state it (lists: per item). A value without quotes fails validation (and is
 * retried). Quotes are then checked against the notes.
 */
function evidenceField(field: FieldDef): z.ZodType {
  if (field.type === "list") {
    return z.object({
      items: z
        .array(z.object({ value: z.string().min(1), quotes: quotes().min(1) }))
        .max(field.maxItems ?? LIST_MAX_DEFAULT),
    });
  }
  return z
    .object({ value: baseSchema(field).nullable(), quotes: quotes() })
    .refine((cell) => cell.value === null || cell.quotes.length > 0, {
      message: "A value needs a quote",
      path: ["quotes"],
    });
}

export function buildEvidenceSchema(fields: FieldDef[]): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) shape[field.name] = evidenceField(field).describe(field.description);
  return z.object(shape);
}

/**
 * Builds the per-row output schema from the user's field definitions.
 * Every field is nullable: the model must return null rather than guess.
 * Every key is required (null, not missing), as strict structured output
 * expects.
 */
export function buildRowSchema(fields: FieldDef[]): RowSchema {
  const shape: Record<string, z.ZodNullable<z.ZodType>> = {};
  for (const field of fields) {
    shape[field.name] = baseSchema(field).nullable().describe(field.description);
  }
  return z.object(shape);
}

// Form state for the setup step. Rules are kept as strings while the user
// types, then converted and validated with the real JobConfigSchema.
import {
  JobConfigSchema,
  type FieldDef,
  type FieldType,
  type JobConfig,
  type JobConfigInput,
  type PlanSite,
  type SourceRole,
} from "@engine/contracts/job-config";

export type DraftField = {
  /** Stable React key (not part of the config). */
  id: string;
  name: string;
  type: FieldType;
  description: string;
  /** Where to look it up (optional). */
  source: string;
  /** Kinds of source that state it, best first (optional). */
  roles: SourceRole[];
  /** Enum options, comma-separated. */
  options: string;
  min: string;
  max: string;
  maxItems: string;
};

export type DraftConfig = {
  keyColumn: string;
  entityDescription: string;
  contextColumns: string[];
  /** The column that changes which sources are right ("" for none). */
  scopeColumn: string;
  /** The source plan's sites, for every row or one scope value. */
  sites: PlanSite[];
  fields: DraftField[];
};

/** Errors keyed by path, e.g. "fields.0.name" or "keyColumn". */
export type DraftErrors = Record<string, string>;

export const MAX_FIELDS = 15;
export const MAX_CONTEXT_COLUMNS = 5;

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `field-${nextId}`;
}

export function emptyField(): DraftField {
  return { id: newId(), name: "", type: "text", description: "", source: "", roles: [], options: "", min: "", max: "", maxItems: "" };
}

export function toDraftField(field: FieldDef): DraftField {
  return {
    id: newId(),
    name: field.name,
    type: field.type,
    description: field.description,
    source: field.source ?? "",
    roles: field.roles ?? [],
    options: field.options?.join(", ") ?? "",
    min: field.min?.toString() ?? "",
    max: field.max?.toString() ?? "",
    maxItems: field.maxItems?.toString() ?? "",
  };
}

export function toDraft(config: JobConfig): DraftConfig {
  return {
    keyColumn: config.keyColumn,
    entityDescription: config.entityDescription,
    contextColumns: config.contextColumns,
    scopeColumn: config.scopeColumn ?? "",
    sites: config.sites ?? [],
    fields: config.fields.map(toDraftField),
  };
}

export function initialDraft(headers: string[]): DraftConfig {
  const key = headers.find((h) => /^(name|company|title)$/i.test(h)) ?? headers[0] ?? "";
  return { keyColumn: key, entityDescription: "", contextColumns: [], scopeColumn: "", sites: [], fields: [emptyField()] };
}

function num(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

export function fromDraftField(d: DraftField): FieldDef {
  return {
    name: d.name.trim(),
    type: d.type,
    description: d.description.trim(),
    source: d.source.trim() || undefined,
    roles: d.roles.length > 0 ? d.roles : undefined,
    options:
      d.type === "enum"
        ? d.options.split(",").map((o) => o.trim()).filter(Boolean)
        : undefined,
    min: d.type === "number" || d.type === "year" ? num(d.min) : undefined,
    max: d.type === "number" || d.type === "year" ? num(d.max) : undefined,
    maxItems: d.type === "list" ? num(d.maxItems) : undefined,
  };
}

export function fromDraft(d: DraftConfig): JobConfigInput {
  return {
    keyColumn: d.keyColumn,
    entityDescription: d.entityDescription.trim(),
    contextColumns: d.contextColumns.filter((c) => c !== d.keyColumn),
    scopeColumn: d.scopeColumn && d.scopeColumn !== d.keyColumn ? d.scopeColumn : undefined,
    sites: d.sites.length > 0 ? d.sites : undefined,
    fields: d.fields.map(fromDraftField),
  };
}

/**
 * Validates the draft against JobConfigSchema plus the same CSV checks the
 * server runs (key column exists). A field may reuse an existing column
 * name: its blank cells get filled and existing values are kept.
 */
export function validateDraft(
  draft: DraftConfig,
  headers: string[],
): { config: JobConfig; errors?: never } | { config?: never; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const parsed = JobConfigSchema.safeParse(fromDraft(draft));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      errors[path] ??= issue.message;
    }
  }
  if (!headers.includes(draft.keyColumn)) errors.keyColumn = "Pick the column that identifies each row.";

  if (Object.keys(errors).length > 0 || !parsed.success) return { errors };
  return { config: parsed.data };
}

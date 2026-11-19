import { z } from "zod";

export const FieldTypeSchema = z.enum([
  "text",
  "number",
  "year",
  "url",
  "enum",
  "list",
  "boolean",
]);

/**
 * Column name: any CSV header as written ("Product Lines", "founded_year"),
 * so a file's own columns can be fields. It is a key in stored rows, so no
 * "." and no leading "$" (MongoDB), and no surrounding spaces.
 */
export const FieldNameSchema = z
  .string()
  .min(1, "Name the column.")
  .max(60, "Keep the column name under 60 characters.")
  .refine((s) => s === s.trim(), "Remove spaces at the start or end of the column name.")
  .refine((s) => !s.includes(".") && !s.startsWith("$"), 'Column names can\'t contain "." or start with "$".')
  .refine((s) => !/[\u0000-\u001f]/.test(s), "Column names can't contain control characters.");

/**
 * Who publishes a kind of fact, for any kind of entity:
 *   own        the entity's (or its maker's) own pages
 *   registry   whoever regulates, certifies or officially records it
 *   reference  general or subject reference works
 *   listing    platforms where it is listed and kept current
 */
export const SourceRoleSchema = z.enum(["own", "registry", "reference", "listing"]);
export const SOURCE_ROLES = SourceRoleSchema.options;

export const FieldDefSchema = z
  .object({
    name: FieldNameSchema,
    type: FieldTypeSchema,
    description: z
      .string()
      .min(3, "Describe what to find (at least 3 characters).")
      .max(200, "Keep the description under 200 characters."),
    // where people who rely on this fact look it up; the search starts there
    source: z.string().trim().max(150, "Keep where to look it up under 150 characters.").optional(),
    // which kinds of source state this fact, best first
    roles: z
      .array(SourceRoleSchema)
      .max(SOURCE_ROLES.length)
      .refine((r) => new Set(r).size === r.length, "Pick each kind of source once.")
      .optional(),
    // required when type = enum
    options: z
      .array(z.string().min(1, "Allowed values can't be empty."))
      .max(30, "Use at most 30 allowed values.")
      .optional(),
    // number / year
    min: z.number("Min must be a number.").optional(),
    max: z.number("Max must be a number.").optional(),
    // list
    maxItems: z
      .number("Max items must be a number.")
      .int("Max items must be a whole number.")
      .min(1, "Max items must be between 1 and 10.")
      .max(10, "Max items must be between 1 and 10.")
      .optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "enum") {
      if (!field.options || field.options.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "Add at least one allowed value.",
        });
      } else if (new Set(field.options).size !== field.options.length) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "Allowed values must be unique.",
        });
      }
    }
    if (
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["min"],
        message: "Min must be less than or equal to max.",
      });
    }
  });

/** Max fields one job may fill. */
export const MAX_FIELDS = 15;

/** Scope values the source plan covers (the most common ones). */
export const MAX_SCOPES = 30;
/** Max sites in one job's source plan. */
export const MAX_SITES = 160;

/**
 * A site people widely accept as reliable for these entities, as a bare
 * host ("wikipedia.org", "nseindia.com"). A pasted URL is cut down to its host.
 */
export const SiteSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, ""))
  .pipe(z.string().regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, { message: "Use a site like wikipedia.org." }));

/**
 * Whether we could read a site when the plan was made:
 *   readable     its pages load as text we can quote
 *   search_only  it blocks us, needs a script or a login: search may still use it
 *   unchecked    added by hand, not checked
 */
export const SiteStatusSchema = z.enum(["readable", "search_only", "unchecked"]);

/** One site of the source plan, for every row (scope null) or for one scope value. */
export const PlanSiteSchema = z.object({
  host: SiteSchema,
  role: SourceRoleSchema.exclude(["own"]),
  scope: z.string().trim().min(1).max(100).nullable(),
  status: SiteStatusSchema,
});

export const JobConfigSchema = z
  .object({
    keyColumn: z.string().min(1, "Pick the column that identifies each row."),
    // e.g. "Indian D2C skincare brands"
    entityDescription: z
      .string()
      .min(3, "Describe what the rows are (at least 3 characters).")
      .max(200, "Keep the description under 200 characters."),
    // extra columns that help disambiguate
    contextColumns: z.array(z.string()).max(5, "Pick at most 5 context columns.").default([]),
    // the column whose values change which sources are right (country, platform, region…)
    scopeColumn: z.string().min(1).optional(),
    // the source plan's sites, ranked below the entity's own site
    sites: z.array(PlanSiteSchema).max(MAX_SITES, `Use at most ${MAX_SITES} sites.`).optional(),
    fields: z
      .array(FieldDefSchema)
      .min(1, "Add at least one field to fill.")
      .max(MAX_FIELDS, `Use at most ${MAX_FIELDS} fields.`),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.fields.forEach((field, i) => {
      // A field may reuse any other CSV column (its blank cells get filled).
      if (field.name === config.keyColumn) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", i, "name"],
          message: `"${field.name}" is the key column; it can't be filled.`,
        });
      }
      if (seen.has(field.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", i, "name"],
          message: `Duplicate field name "${field.name}".`,
        });
      }
      seen.add(field.name);
    });
  });

export type FieldType = z.infer<typeof FieldTypeSchema>;
export type SourceRole = z.infer<typeof SourceRoleSchema>;
export type SiteStatus = z.infer<typeof SiteStatusSchema>;
export type PlanSite = z.infer<typeof PlanSiteSchema>;
export type FieldDef = z.infer<typeof FieldDefSchema>;
export type JobConfig = z.infer<typeof JobConfigSchema>;
/** Shape before defaults are applied (e.g. form state, request bodies). */
export type JobConfigInput = z.input<typeof JobConfigSchema>;

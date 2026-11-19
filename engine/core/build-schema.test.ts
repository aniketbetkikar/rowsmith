import { describe, expect, it } from "vitest";
import type { FieldDef } from "@engine/contracts/job-config";
import { ConfigError } from "@engine/utils/errors";
import { buildEvidenceSchema, buildRowSchema } from "./build-schema";

function fieldSchema(field: FieldDef) {
  const schema = buildRowSchema([field]);
  return (value: unknown) => schema.safeParse({ [field.name]: value }).success;
}

const currentYear = new Date().getFullYear();

describe("buildRowSchema", () => {
  describe("text", () => {
    const accepts = fieldSchema({ name: "summary", type: "text", description: "Short summary" });

    it("accepts a non-empty string", () => {
      expect(accepts("Note-taking app")).toBe(true);
    });
    it("rejects empty, too long and non-string values", () => {
      expect(accepts("")).toBe(false);
      expect(accepts("x".repeat(501))).toBe(false);
      expect(accepts(42)).toBe(false);
    });
    it("accepts exactly 500 characters", () => {
      expect(accepts("x".repeat(500))).toBe(true);
    });
  });

  describe("number", () => {
    it("accepts any finite number without rules", () => {
      const accepts = fieldSchema({ name: "employees", type: "number", description: "Headcount" });
      expect(accepts(-3.5)).toBe(true);
      expect(accepts(1_000_000)).toBe(true);
      expect(accepts("12")).toBe(false);
      expect(accepts(Number.NaN)).toBe(false);
    });
    it("enforces min and max", () => {
      const accepts = fieldSchema({
        name: "rating",
        type: "number",
        description: "Rating",
        min: 1,
        max: 5,
      });
      expect(accepts(1)).toBe(true);
      expect(accepts(5)).toBe(true);
      expect(accepts(0.9)).toBe(false);
      expect(accepts(5.1)).toBe(false);
    });
  });

  describe("year", () => {
    it("defaults to 1800..current year", () => {
      const accepts = fieldSchema({ name: "founded", type: "year", description: "Year founded" });
      expect(accepts(1800)).toBe(true);
      expect(accepts(currentYear)).toBe(true);
      expect(accepts(1799)).toBe(false);
      expect(accepts(currentYear + 1)).toBe(false);
    });
    it("requires an integer", () => {
      const accepts = fieldSchema({ name: "founded", type: "year", description: "Year founded" });
      expect(accepts(2013.5)).toBe(false);
      expect(accepts("2013")).toBe(false);
    });
    it("uses custom min and max", () => {
      const accepts = fieldSchema({
        name: "founded",
        type: "year",
        description: "Year founded",
        min: 2000,
        max: 2010,
      });
      expect(accepts(2000)).toBe(true);
      expect(accepts(2010)).toBe(true);
      expect(accepts(1999)).toBe(false);
      expect(accepts(2011)).toBe(false);
    });
  });

  describe("url", () => {
    const accepts = fieldSchema({ name: "website", type: "url", description: "Official site" });

    it("accepts http and https URLs", () => {
      expect(accepts("https://notion.so")).toBe(true);
      expect(accepts("http://example.com/path?q=1")).toBe(true);
    });
    it("rejects bare domains and other protocols", () => {
      expect(accepts("notion.so")).toBe(false);
      expect(accepts("ftp://example.com")).toBe(false);
      expect(accepts("javascript:alert(1)")).toBe(false);
      expect(accepts("")).toBe(false);
    });
  });

  describe("enum", () => {
    const accepts = fieldSchema({
      name: "industry",
      type: "enum",
      description: "Main industry",
      options: ["SaaS", "Fintech"],
    });

    it("accepts only the allowed options", () => {
      expect(accepts("SaaS")).toBe(true);
      expect(accepts("Fintech")).toBe(true);
      expect(accepts("saas")).toBe(false);
      expect(accepts("Healthcare")).toBe(false);
    });
    it("throws a ConfigError when options are missing or empty", () => {
      expect(() =>
        buildRowSchema([{ name: "industry", type: "enum", description: "Main industry" }]),
      ).toThrow(ConfigError);
      expect(() =>
        buildRowSchema([
          { name: "industry", type: "enum", description: "Main industry", options: [] },
        ]),
      ).toThrow(ConfigError);
    });
  });

  describe("list", () => {
    it("defaults to max 5 items", () => {
      const accepts = fieldSchema({ name: "products", type: "list", description: "Products" });
      expect(accepts([])).toBe(true);
      expect(accepts(["a", "b", "c", "d", "e"])).toBe(true);
      expect(accepts(["a", "b", "c", "d", "e", "f"])).toBe(false);
    });
    it("uses a custom maxItems", () => {
      const accepts = fieldSchema({
        name: "products",
        type: "list",
        description: "Products",
        maxItems: 2,
      });
      expect(accepts(["a", "b"])).toBe(true);
      expect(accepts(["a", "b", "c"])).toBe(false);
    });
    it("requires string items", () => {
      const accepts = fieldSchema({ name: "products", type: "list", description: "Products" });
      expect(accepts([1, 2])).toBe(false);
      expect(accepts("a, b")).toBe(false);
    });
  });

  describe("boolean", () => {
    const accepts = fieldSchema({ name: "is_public", type: "boolean", description: "Listed?" });

    it("accepts true and false only", () => {
      expect(accepts(true)).toBe(true);
      expect(accepts(false)).toBe(true);
      expect(accepts("true")).toBe(false);
      expect(accepts(1)).toBe(false);
    });
  });

  describe("row object", () => {
    const fields: FieldDef[] = [
      { name: "summary", type: "text", description: "Short summary" },
      { name: "employees", type: "number", description: "Headcount" },
      { name: "founded", type: "year", description: "Year founded" },
      { name: "website", type: "url", description: "Official site" },
      { name: "industry", type: "enum", description: "Main industry", options: ["SaaS"] },
      { name: "products", type: "list", description: "Products" },
      { name: "is_public", type: "boolean", description: "Listed?" },
    ];
    const schema = buildRowSchema(fields);
    const allNull = Object.fromEntries(fields.map((f) => [f.name, null]));

    it("makes every field nullable", () => {
      expect(schema.safeParse(allNull).success).toBe(true);
    });
    it("requires every key (null, not missing)", () => {
      const { website: _omitted, ...missingOne } = allNull;
      expect(schema.safeParse(missingOne).success).toBe(false);
    });
    it("strips keys that are not defined fields", () => {
      const parsed = schema.parse({ ...allNull, invented: "value" });
      expect(parsed).not.toHaveProperty("invented");
    });
    it("attaches each field description", () => {
      for (const field of fields) {
        expect(schema.shape[field.name]?.description).toBe(field.description);
      }
    });
    it("parses a fully filled row", () => {
      const row = {
        summary: "All-in-one workspace",
        employees: 800,
        founded: 2013,
        website: "https://notion.so",
        industry: "SaaS",
        products: ["Notion", "Notion Calendar"],
        is_public: false,
      };
      expect(schema.parse(row)).toEqual(row);
    });
  });
});

describe("buildEvidenceSchema", () => {
  const schema = buildEvidenceSchema([
    { name: "founded", type: "year", description: "Year founded" },
    { name: "founders", type: "list", description: "Co-founders", maxItems: 2 },
  ]);

  it("accepts a value with its quote, list items with theirs, and null with no quote", () => {
    const ok = {
      founded: { value: 2013, quotes: ["founded in 2013"] },
      founders: { items: [{ value: "Ivan Zhao", quotes: ["Ivan Zhao co-founded Notion"] }] },
    };
    expect(schema.parse(ok)).toEqual(ok);
    expect(schema.safeParse({ founded: { value: null, quotes: [] }, founders: { items: [] } }).success).toBe(true);
  });

  it("rejects a value without a quote, field rule violations and too many items", () => {
    const item = { value: "A", quotes: ["A founded it"] };
    expect(schema.safeParse({ founded: { value: 2013, quotes: [] }, founders: { items: [] } }).success).toBe(false);
    expect(schema.safeParse({ founded: { value: 1500, quotes: ["in 1500"] }, founders: { items: [] } }).success).toBe(false);
    expect(schema.safeParse({ founded: { value: null, quotes: [] }, founders: { items: [item, item, item] } }).success).toBe(false);
  });
});

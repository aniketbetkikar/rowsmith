import { describe, expect, it } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import { emptyField, fromDraft, initialDraft, toDraft, validateDraft, type DraftConfig } from "./draft";
import { formatUsd, formatValue, hostname } from "./format";

const headers = ["name", "city"];

function draft(overrides: Partial<DraftConfig> = {}): DraftConfig {
  return {
    keyColumn: "name",
    entityDescription: "Software companies",
    contextColumns: ["city"],
    scopeColumn: "",
    sites: [],
    fields: [{ ...emptyField(), name: "founded", type: "year", description: "Year founded", min: "1990" }],
    ...overrides,
  };
}

describe("draft config", () => {
  it("round-trips a JobConfig through the draft", () => {
    const config: JobConfig = {
      keyColumn: "name",
      entityDescription: "Software companies",
      contextColumns: ["city"],
      scopeColumn: "city",
      sites: [{ host: "crunchbase.com", role: "listing", scope: null, status: "readable" }],
      fields: [
        { name: "industry", type: "enum", description: "Industry", options: ["SaaS", "Fintech"] },
        { name: "founded", type: "year", description: "Year founded", source: "Company website, else Crunchbase", roles: ["own", "listing"], min: 1990, max: 2020 },
        { name: "products", type: "list", description: "Products", maxItems: 3 },
      ],
    };
    expect(validateDraft(toDraft(config), headers).config).toEqual(config);
  });

  it("only keeps rules that apply to the field type", () => {
    const d = draft({
      fields: [{ ...emptyField(), name: "x", type: "text", description: "Xyz", options: "a,b", min: "1", maxItems: "2" }],
    });
    expect(fromDraft(d).fields[0]).toEqual({
      name: "x", type: "text", description: "Xyz", source: undefined, options: undefined, min: undefined, max: undefined, maxItems: undefined,
    });
  });

  it("splits and trims enum options", () => {
    const d = draft({ fields: [{ ...emptyField(), name: "x", type: "enum", description: "Xyz", options: " A , B,,C " }] });
    expect(fromDraft(d).fields[0]?.options).toEqual(["A", "B", "C"]);
  });

  it("returns errors keyed by path", () => {
    const result = validateDraft(
      draft({
        keyColumn: "missing",
        entityDescription: "",
        fields: [
          { ...emptyField(), name: "bad.name", description: "Xyz" },
          { ...emptyField(), name: "e", type: "enum", description: "Xyz" },
          { ...emptyField(), name: "n", type: "number", description: "Xyz", min: "5", max: "1" },
          { ...emptyField(), name: "missing", description: "Xyz" },
        ],
      }),
      headers,
    );
    expect(Object.keys(result.errors ?? {}).sort()).toEqual([
      "entityDescription",
      "fields.0.name",
      "fields.1.options",
      "fields.2.min",
      "fields.3.name",
      "keyColumn",
    ]);
  });

  it("lets a field reuse a non-key column", () => {
    const d = draft({ contextColumns: [], fields: [{ ...emptyField(), name: "city", description: "City" }] });
    expect(validateDraft(d, headers).errors).toBeUndefined();
  });

  it("drops the key column from context columns", () => {
    expect(fromDraft(draft({ contextColumns: ["name", "city"] })).contextColumns).toEqual(["city"]);
  });

  it("guesses a sensible key column", () => {
    expect(initialDraft(["id", "Company", "city"]).keyColumn).toBe("Company");
    expect(initialDraft(["id", "city"]).keyColumn).toBe("id");
  });
});

describe("format", () => {
  it("formats costs, values and hostnames", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.00312)).toBe("$0.0031");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatValue(null)).toBeNull();
    expect(formatValue([])).toBeNull();
    expect(formatValue(["a", "b"])).toBe("a, b");
    expect(formatValue(false)).toBe("No");
    expect(formatValue(2013)).toBe("2013");
    expect(hostname("https://www.notion.com/about")).toBe("notion.com");
  });
});

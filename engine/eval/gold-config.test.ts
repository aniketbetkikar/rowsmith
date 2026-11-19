import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JobConfigSchema } from "@engine/contracts/job-config";
import { parseJsonObject } from "./baseline";
import { GOLD_CONFIG, loadGold } from "./gold-config";

const GOLD_PATH = join(process.cwd(), "engine", "eval", "gold.csv");

function tempCsv(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "rowsmith-gold-")), "gold.csv");
  writeFileSync(path, content);
  return path;
}

describe("GOLD_CONFIG", () => {
  it("is a valid JobConfig", () => {
    expect(JobConfigSchema.safeParse(GOLD_CONFIG).success).toBe(true);
  });
});

describe("loadGold", () => {
  const rows = loadGold(GOLD_PATH);

  it("loads and validates every row of gold.csv", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const { row } of rows) expect(row.key).not.toBe("");
  });

  it("never leaks gold answers into the enrichRow input", () => {
    const fieldNames = GOLD_CONFIG.fields.map((f) => f.name);
    for (const { row } of rows) {
      for (const name of fieldNames) expect(row.input).not.toHaveProperty(name);
    }
  });

  it("converts cells to typed values (lists, booleans, years, null)", () => {
    const path = tempCsv(
      "name,country,industry,hq_country,founded,website,is_public,founders,ceo,stock_ticker\n" +
        "Acme,USA,Other,United States,2001,https://acme.com,true,A One| B Two ,,ACME\n",
    );
    expect(loadGold(path)[0]).toEqual({
      row: { key: "Acme", input: { name: "Acme", country: "USA" } },
      gold: {
        industry: "Other",
        hq_country: "United States",
        founded: 2001,
        website: "https://acme.com",
        is_public: true,
        founders: ["A One", "B Two"],
        ceo: null,
        stock_ticker: "ACME",
      },
    });
  });

  it("rejects rows that fail the schema, naming the row", () => {
    const path = tempCsv(
      "name,country,industry,hq_country,founded,website,is_public,founders,ceo,stock_ticker\n" +
        "Acme,USA,Robotics,United States,2001,https://acme.com,true,,,\n",
    );
    expect(() => loadGold(path)).toThrow(/row 2 \(Acme\): industry/);
  });

  it("rejects a file missing field columns", () => {
    expect(() => loadGold(tempCsv("name,country\nAcme,USA\n"))).toThrow(/missing columns/);
  });
});

describe("parseJsonObject", () => {
  it("parses a bare or fenced JSON object", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('```json\n{"a": "x"}\n```')).toEqual({ a: "x" });
  });
  it("returns null for non-objects and invalid JSON", () => {
    expect(parseJsonObject("no json here")).toBeNull();
    expect(parseJsonObject("{not: json}")).toBeNull();
    expect(parseJsonObject("[1, 2]")).toBeNull();
  });
});

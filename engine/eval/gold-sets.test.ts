import { describe, expect, it } from "vitest";
import { JobConfigSchema } from "@engine/contracts/job-config";
import { loadGold } from "./gold-config";
import { GOLD_SETS } from "./gold-sets";

describe("GOLD_SETS", () => {
  it("has unique names", () => {
    const names = GOLD_SETS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const set of GOLD_SETS) {
    describe(set.name, () => {
      it("has a valid JobConfig", () => {
        expect(JobConfigSchema.safeParse(set.config).success).toBe(true);
      });

      it("loads every row and never leaks answers into the input", () => {
        const rows = loadGold(set.file, set.config);
        expect(rows.length).toBeGreaterThan(0);
        for (const { row } of rows) {
          expect(row.key).not.toBe("");
          for (const field of set.config.fields) expect(row.input).not.toHaveProperty(field.name);
        }
      });
    });
  }
});

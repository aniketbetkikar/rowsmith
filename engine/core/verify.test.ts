import { describe, expect, it } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import type { Checked } from "./evidence";
import { applyVerdicts, claimedValues, verdictsSchemaFor, verifyPrompt } from "./verify";

const config: JobConfig = {
  keyColumn: "name",
  entityDescription: "Payment companies",
  contextColumns: [],
  fields: [
    { name: "key_partners", type: "list", description: "Firms with a commercial relationship; not customers or competitors" },
    { name: "ceo", type: "text", description: "Current CEO" },
    { name: "founded", type: "year", description: "Year founded" },
  ],
};
const row = { key: "Razorpay", input: { name: "Razorpay" } };

const checked: Checked = {
  output: { key_partners: ["Visa", "PhonePe"], ceo: "Harshil Mathur", founded: null },
  evidence: {
    key_partners: {
      quotes: [
        { text: "Razorpay processes Visa cards", sources: [1] },
        { text: "PhonePe is a UPI app", sources: [2] },
      ],
    },
    ceo: { quotes: [{ text: "CEO Harshil Mathur said", sources: [1] }] },
    founded: { quotes: [], blank: "not_found" },
  },
};

describe("claimedValues", () => {
  it("lists every filled scalar and each list item with its quote", () => {
    expect(claimedValues(config, checked)).toEqual([
      { id: "key_partners#1", field: "key_partners", value: "Visa", quote: "Razorpay processes Visa cards" },
      { id: "key_partners#2", field: "key_partners", value: "PhonePe", quote: "PhonePe is a UPI app" },
      { id: "ceo", field: "ceo", value: "Harshil Mathur", quote: "CEO Harshil Mathur said" },
    ]);
  });
});

describe("verifyPrompt", () => {
  it("includes the date, field definitions, the rules and every id", () => {
    const prompt = verifyPrompt(config, row, claimedValues(config, checked), "2026-10-29");
    expect(prompt.startsWith("Today is 2026-10-29.")).toBe(true);
    expect(prompt).toContain("not customers or competitors");
    expect(prompt).toContain("about Razorpay itself");
    expect(prompt).toContain("not a former one, a plan or an announced deal");
    expect(prompt).toContain('[key_partners#2] key_partners: "PhonePe"\n  quotes: "PhonePe is a UPI app"');
    expect(prompt).toContain("Rewording, shortening or combining what they say is fine");
    expect(prompt).toContain("[ceo] ceo:");
  });
});

describe("verdictsSchemaFor", () => {
  const schema = verdictsSchemaFor(claimedValues(config, checked));
  const all = ["key_partners#1", "key_partners#2", "ceo"].map((id) => ({ id, supported: true }));

  it("accepts verdicts covering every id, brackets allowed", () => {
    expect(schema.safeParse({ checks: all }).success).toBe(true);
    expect(schema.safeParse({ checks: all.map((c) => ({ ...c, id: `[${c.id}]` })) }).success).toBe(true);
  });

  it("rejects a partial or empty list, naming the missing ids", () => {
    const partial = schema.safeParse({ checks: all.slice(0, 1) });
    expect(partial.success).toBe(false);
    expect(partial.error?.issues[0]?.message).toBe("Missing a check for: key_partners#2, ceo");
    expect(schema.safeParse({ checks: [] }).success).toBe(false);
  });
});

describe("applyVerdicts", () => {
  it("keeps supported values and drops the rest, keeping quotes aligned with list items", () => {
    const result = applyVerdicts(config, checked, {
      checks: [
        { id: "key_partners#1", supported: true },
        { id: "key_partners#2", supported: false },
        { id: "ceo", supported: true },
      ],
    });
    expect(result.output).toEqual({ key_partners: ["Visa"], ceo: "Harshil Mathur", founded: null });
    expect(result.evidence.key_partners?.quotes).toEqual([{ text: "Razorpay processes Visa cards", sources: [1] }]);
    expect(result.evidence.founded).toEqual({ quotes: [], blank: "not_found" });
  });

  it("treats a missing verdict as not supported, and an emptied list as rejected", () => {
    const result = applyVerdicts(config, checked, { checks: [{ id: "key_partners#2", supported: false }] });
    expect(result.output).toEqual({ key_partners: null, ceo: null, founded: null });
    expect(result.evidence.key_partners).toEqual({ quotes: [], blank: "rejected" });
    expect(result.evidence.ceo).toEqual({ quotes: [], blank: "rejected" });
  });
});

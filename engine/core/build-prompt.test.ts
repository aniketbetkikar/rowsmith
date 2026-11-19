import { describe, expect, it } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import { extractPrompt, fieldList, searchPrompt } from "./build-prompt";

const config: JobConfig = {
  keyColumn: "name",
  entityDescription: "Software companies",
  contextColumns: ["city", "country"],
  fields: [
    { name: "industry", type: "enum", description: "Main industry", options: ["SaaS", "Fintech"] },
    { name: "founded", type: "year", description: "Year founded", min: 1990 },
    { name: "products", type: "list", description: "Main products", maxItems: 3 },
    { name: "website", type: "url", description: "Official website" },
  ],
};

const row = { key: "Zerodha", input: { name: "Zerodha", city: "Bengaluru", country: "" } };

describe("fieldList", () => {
  it("describes each field's format and rules", () => {
    const list = fieldList(config.fields);
    expect(list).toContain("- industry (one of: SaaS, Fintech): Main industry");
    expect(list).toContain(`- founded (4-digit year between 1990 and ${new Date().getFullYear()})`);
    expect(list).toContain("- products (list of up to 3 short items)");
    expect(list).toContain("- website (full http(s) URL)");
  });

  it("adds where to look a field up only when asked (search, not extract or verify)", () => {
    const fields = [{ ...config.fields[1]!, source: "Company website, else Tracxn" }];
    expect(fieldList(fields)).not.toContain("Look it up on");
    expect(fieldList(fields, { withSources: true })).toContain("Year founded Look it up on: Company website, else Tracxn.");
    expect(searchPrompt({ ...config, fields }, row)).toContain("Look it up on: Company website, else Tracxn.");
    expect(extractPrompt({ ...config, fields }, row, "notes")).not.toContain("Look it up on");
  });
});

describe("searchPrompt", () => {
  it("includes the key, entity description, non-empty context and fields", () => {
    const prompt = searchPrompt(config, row);
    expect(prompt).toContain("Research Zerodha (Software companies).");
    expect(prompt).toContain("Context: city: Bengaluru.");
    expect(prompt).not.toContain("country:");
    expect(prompt).toContain("- industry (one of: SaaS, Fintech)");
    expect(prompt).toContain("Cite sources.");
  });

  it("states today's date and the grounding rules", () => {
    const prompt = searchPrompt(config, row, "2026-10-29");
    expect(prompt.startsWith("Today is 2026-10-29.")).toBe(true);
    expect(prompt).toContain("people who rely on that kind of fact actually check");
    expect(prompt).toContain("the version most people in this row's market would mean");
    expect(prompt).toContain("use the most recent source");
    expect(prompt).toContain("If sources disagree, report each version");
    expect(prompt).toContain("Never fill gaps from memory");
    expect(prompt).toContain("about this exact Zerodha");
    expect(prompt).toContain("Run at most 2 web search queries");
  });

  it("omits the context line when no context values exist", () => {
    const prompt = searchPrompt({ ...config, contextColumns: [] }, row);
    expect(prompt).not.toContain("Context:");
  });
});

describe("extractPrompt", () => {
  it("demands notes-only answers with nulls instead of guesses", () => {
    const prompt = extractPrompt(config, row, "Zerodha was founded in 2010.");
    expect(prompt).toContain("Using ONLY the research notes");
    expect(prompt).toContain("Use null when the notes don't support a value. Do not guess, infer or use your own knowledge.");
    expect(prompt).toContain("Zerodha was founded in 2010.");
    expect(prompt).not.toContain("failed validation");
  });

  it("states the date and the rules for fit, identity, conflicts and recency", () => {
    const prompt = extractPrompt(config, row, "notes", undefined, "2026-10-29");
    expect(prompt.startsWith("Today is 2026-10-29.")).toBe(true);
    expect(prompt).toContain("Source tiers, most trusted first: official");
    expect(prompt).toContain("must fit the field's description exactly");
    expect(prompt).toContain("about a different entity than Zerodha");
    expect(prompt).toContain("If claims conflict, use the one from the more trusted tier");
    expect(prompt).toContain("When a field asks for a current value");
  });

  it("appends previous validation errors when given", () => {
    const prompt = extractPrompt(config, row, "notes", [
      "founded: Too small",
      "website: Invalid URL",
    ]);
    expect(prompt).toContain(
      "Your previous answer failed validation: founded: Too small; website: Invalid URL. Fix only these.",
    );
  });

  it("marks empty notes explicitly", () => {
    expect(extractPrompt(config, row, "   ")).toContain("(no research notes were found)");
  });
});

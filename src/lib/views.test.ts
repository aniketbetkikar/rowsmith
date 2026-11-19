import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import { EMPTY_USAGE, type RowDoc } from "@engine/db/rows";
import { cellCounts, evidenceCell, mergedOutput, researchedEvidence, resultCsv } from "./views";

vi.mock("server-only", () => ({}));

const headers = ["tool", "category", "website"];
const config: JobConfig = {
  keyColumn: "tool",
  entityDescription: "SaaS tools",
  contextColumns: [],
  fields: [
    { name: "category", type: "text", description: "Product category" },
    { name: "website", type: "url", description: "Official website" },
    { name: "founded", type: "year", description: "Year founded" },
  ],
};

function row(input: Record<string, string>, output: RowDoc["output"], status: RowDoc["status"] = "done"): RowDoc {
  return {
    _id: new ObjectId(),
    jobId: new ObjectId(),
    index: 0,
    key: input.tool ?? "",
    keyNorm: (input.tool ?? "").toLowerCase(),
    input,
    output,
    sources: [],
    evidence: {},
    status,
    attempts: 1,
    usage: EMPTY_USAGE,
    costUsd: 0,
  };
}

describe("reused columns", () => {
  it("keeps the user's value and fills only blank cells", () => {
    const r = row(
      { tool: "Notion", category: "", website: "https://www.notion.so" },
      { category: "Productivity", website: "https://notion.com", founded: 2013 },
    );
    expect(mergedOutput(r)).toEqual({ category: "Productivity", website: "https://www.notion.so", founded: 2013 });
  });

  it("fills reused columns in place and appends only new fields", () => {
    const csv = resultCsv({ headers, config }, [
      row({ tool: "Notion", category: "", website: "https://www.notion.so" }, { category: "Productivity", website: null, founded: 2013 }),
      row({ tool: "Ghost", category: "", website: "https://ghost.org" }, null, "failed"),
    ]);
    const [head, notion, ghost] = csv.trim().split(/\r?\n/);
    expect(head).toBe("tool,category,website,founded,_sources,_evidence,_status,_cost_usd,_comments");
    expect(notion).toBe("Notion,Productivity,https://www.notion.so,2013,,,done,0.000000,");
    expect(ghost).toBe("Ghost,,https://ghost.org,,,,failed,0.000000,Couldn't be researched (see _status). Re-running the job may fill it.");
  });
});

describe("cellCounts", () => {
  const fields = ["category", "website", "founded"];

  it("counts researched cells: filled, and searched but not found", () => {
    const rows = [
      row({ tool: "Notion", category: "", website: "" }, { category: "Productivity", website: null, founded: 2013 }),
      row({ tool: "Linear", category: "", website: "" }, { category: "", website: "https://linear.app", founded: [] }),
    ];
    expect(cellCounts(rows, fields)).toEqual({ filled: 3, blank: 3 });
  });

  it("skips duplicates, failed and pending rows, and cells the user already filled", () => {
    const rows = [
      row({ tool: "Notion", category: "Docs", website: "" }, { category: "Productivity", website: "https://notion.so", founded: 2013 }),
      row({ tool: "Notion", category: "", website: "" }, { category: "Productivity", website: "https://notion.so", founded: 2013 }, "duplicate"),
      row({ tool: "Ghost", category: "", website: "" }, null, "failed"),
      row({ tool: "Loom", category: "", website: "" }, null, "pending"),
    ];
    expect(cellCounts(rows, fields)).toEqual({ filled: 2, blank: 0 });
  });
});

describe("evidence", () => {
  const evidence = {
    founded: { quotes: [{ text: "Founded in 2013.", sources: [1] }] },
    founders: { quotes: [{ text: "Ivan Zhao co-founded it", sources: [1, 2] }, { text: "Simon Last co-founded it", sources: [2] }] },
    ceo: { quotes: [], blank: "rejected" as const },
    category: { quotes: [], blank: "not_found" as const },
  };

  it("drops evidence for cells the user filled", () => {
    expect(Object.keys(researchedEvidence({ input: { category: "Productivity" }, evidence }))).toEqual(["founded", "founders", "ceo"]);
  });

  it("writes one line per field: quotes with source numbers, or why it is blank", () => {
    expect(evidenceCell(["founded", "founders", "ceo", "missing"], evidence)).toBe(
      [
        'founded: "Founded in 2013." [1]',
        'founders: "Ivan Zhao co-founded it" [1, 2] | "Simon Last co-founded it" [2]',
        "ceo: Removed: the source quote doesn't support it",
      ].join("\n"),
    );
  });
});

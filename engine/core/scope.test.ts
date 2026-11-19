import { describe, expect, it } from "vitest";
import type { PlanSite } from "@engine/contracts/job-config";
import { rowSites, scopeOf, tierHints } from "./scope";

const sites: PlanSite[] = [
  { host: "reviews.example", role: "reference", scope: null, status: "readable" },
  { host: "store-a.example", role: "listing", scope: "iOS", status: "readable" },
  { host: "rating-board.example", role: "registry", scope: "Android", status: "search_only" },
];
const config = { scopeColumn: "platform", sites };

describe("scope", () => {
  it("is the row's value in the scope column", () => {
    expect(scopeOf(config, { platform: " iOS " })).toBe("iOS");
    expect(scopeOf(config, { platform: "" })).toBeNull();
    expect(scopeOf({}, { platform: "iOS" })).toBeNull();
  });

  it("gives a row the sites for every row plus those for its scope, case-insensitively", () => {
    expect(rowSites(config, { key: "X", input: { platform: "ios" } }).map((s) => s.host)).toEqual(["reviews.example", "store-a.example"]);
    expect(rowSites(config, { key: "X", input: {} }).map((s) => s.host)).toEqual(["reviews.example"]);
  });

  it("ranks registries as authority and the rest as reference", () => {
    expect(tierHints(config, { key: "X", input: { platform: "Android" } })).toEqual({
      authority: ["rating-board.example"],
      trusted: ["reviews.example"],
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeColumns } from "@engine/contracts/columns";
import { extractStructured } from "./extract";
import type { FetchLike } from "./page";
import { suggestSetup } from "./suggest";

vi.mock("./extract", () => ({ extractStructured: vi.fn() }));

const extract = vi.mocked(extractStructured);

const usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
const ok = <T,>(parsed: T) => ({ parsed, issues: [], usage, model: "suggest-model" });

function field(name: string) {
  return {
    name,
    type: "text" as const,
    description: `The ${name}`,
    source: null,
    roles: ["registry", "reference", "registry"] as ("registry" | "reference")[],
    options: null,
    min: null,
    max: null,
    maxItems: null,
  };
}

function setup(fields: string[], scopeColumn: string | null = null) {
  return ok({ keyColumn: "name", entityDescription: "Mobile apps", contextColumns: ["platform"], scopeColumn, fields: fields.map(field) });
}

/** Every homepage is readable, except dead.example (no such host) and blocked.example (403). */
const sitesFetch: FetchLike = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("dead.example")) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  if (url.includes("blocked.example")) return new Response("", { status: 403 });
  const text = Array.from({ length: 20 }, (_, i) => `Listing number ${i} of apps with ratings and versions.`).join(" ");
  return new Response(`<html><body><p>${text}</p></body></html>`);
}) as FetchLike;

const prompt = (call = 0) => extract.mock.calls[call]?.[2] ?? "";

describe("suggestSetup", () => {
  beforeEach(() => extract.mockReset());

  it("uses only the file's empty columns when it has some", async () => {
    extract
      .mockResolvedValueOnce(setup(["ceo", "founded_year", "Founded Year", "revenue", "website"]))
      .mockResolvedValueOnce(ok({ sites: [] }));
    const rows = [
      { name: "Notion", country: "USA", website: "", "Founded Year": "", ceo: "" },
      { name: "Canva", country: "Australia", website: "canva.com", "Founded Year": "", ceo: "" },
      { name: "Zerodha", country: "India", website: "", "Founded Year": "", ceo: "" },
    ];

    const config = await suggestSetup(["name", "country", "website", "Founded Year", "ceo"], rows, undefined, { fetchImpl: sitesFetch });

    // File order, headers as written; the invented fields are dropped.
    expect(config.fields.map((f) => f.name)).toEqual(["website", "Founded Year", "ceo"]);
    // Kinds of source are kept once each, in order.
    expect(config.fields[0]?.roles).toEqual(["registry", "reference"]);
    expect(prompt()).toContain('["website","Founded Year","ceo"]');
    expect(prompt()).not.toContain("4-8");
    expect(config.sites).toBeUndefined();
  });

  it("uses Title Case empty columns and invents none", async () => {
    const headers = ["Manufacturer Name", "Website", "Product Lines", "Lead Time", "Minimum Order Quantity"];
    extract
      .mockResolvedValueOnce(
        ok({
          keyColumn: "Manufacturer Name",
          entityDescription: "Manufacturers",
          contextColumns: ["Website"],
          scopeColumn: null,
          fields: ["headquarters_country", "Product Lines", "Lead Time", "Minimum Order Quantity", "year_founded"].map(field),
        }),
      )
      .mockResolvedValueOnce(ok({ sites: [] }));
    const rows = [
      { "Manufacturer Name": "Ironwood", Website: "https://ironwood.example", "Product Lines": "", "Lead Time": "", "Minimum Order Quantity": "" },
      { "Manufacturer Name": "Atlas", Website: "https://atlas.example", "Product Lines": "", "Lead Time": "", "Minimum Order Quantity": "" },
    ];

    const config = await suggestSetup(headers, rows, undefined, { fetchImpl: sitesFetch });

    expect(config.fields.map((f) => f.name)).toEqual(["Product Lines", "Lead Time", "Minimum Order Quantity"]);
    expect(config.contextColumns).toEqual(["Website"]);
    expect(prompt()).not.toContain("4-8");
  });

  it("proposes new fields when no column is empty", async () => {
    extract.mockResolvedValueOnce(setup(["founded_year", "website"])).mockResolvedValueOnce(ok({ sites: [] }));
    const rows = [{ name: "Notion", country: "USA" }, { name: "Canva", country: "Australia" }];

    const config = await suggestSetup(["name", "country"], rows, undefined, { fetchImpl: sitesFetch });

    expect(config.fields.map((f) => f.name)).toEqual(["founded_year", "website"]);
    expect(prompt()).toContain("4-8");
  });

  it("caps the empty columns at the field limit", async () => {
    const headers = ["name", ...Array.from({ length: 20 }, (_, i) => `col_${i}`)];
    extract.mockResolvedValueOnce(setup(headers.slice(1))).mockResolvedValueOnce(ok({ sites: [] }));

    const config = await suggestSetup(headers, [{ name: "Notion" }], undefined, { fetchImpl: sitesFetch });

    expect(config.fields).toHaveLength(15);
    expect(config.fields.at(-1)?.name).toBe("col_14");
  });

  it("plans sites for every scope value in the file and checks each one", async () => {
    const headers = ["name", "platform", "rating"];
    const all = [
      ...Array.from({ length: 30 }, (_, i) => ({ name: `App ${i}`, platform: "iOS", rating: "" })),
      ...Array.from({ length: 20 }, (_, i) => ({ name: `Droid ${i}`, platform: "Android", rating: "" })),
      { name: "Late", platform: "HarmonyOS", rating: "" },
    ];
    extract.mockResolvedValueOnce(setup(["rating"], "platform")).mockResolvedValueOnce(
      ok({
        sites: [
          { host: "https://www.Reviews.example/apps", role: "reference", scope: null },
          { host: "en.wikipedia.org", role: "reference", scope: null },
          { host: "store-a.example", role: "listing", scope: "ios" },
          { host: "store-b.example", role: "listing", scope: "Android" },
          { host: "store-c.example", role: "listing", scope: "HarmonyOS" },
          { host: "blocked.example", role: "registry", scope: "Android" },
          { host: "dead.example", role: "listing", scope: null },
          { host: "elsewhere.example", role: "listing", scope: "Windows Phone" },
        ],
      }),
    );

    const config = await suggestSetup(headers, all.slice(0, 5), summarizeColumns(headers, all), { fetchImpl: sitesFetch });

    expect(config.scopeColumn).toBe("platform");
    // The plan sees every platform in the file, not only the sample's.
    expect(prompt(1)).toContain("iOS (30); Android (20); HarmonyOS (1)");
    expect(config.sites).toEqual([
      { host: "reviews.example", role: "reference", scope: null, status: "readable" },
      { host: "store-a.example", role: "listing", scope: "iOS", status: "readable" },
      { host: "store-b.example", role: "listing", scope: "Android", status: "readable" },
      { host: "store-c.example", role: "listing", scope: "HarmonyOS", status: "readable" },
      { host: "blocked.example", role: "registry", scope: "Android", status: "search_only" },
    ]);
  });
});

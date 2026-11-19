import { describe, expect, it } from "vitest";
import { articleFor, linksFromClaims, titleMatchesKey } from "./wikidata";

describe("titleMatchesKey", () => {
  it("needs every word of the key to start a word of the title", () => {
    expect(titleMatchesKey("Apple", "Apple Inc.")).toBe(true);
    expect(titleMatchesKey("Teva Pharmaceutical", "Teva Pharmaceuticals")).toBe(true);
    expect(titleMatchesKey("Nestlé", "Nestlé")).toBe(true);
    expect(titleMatchesKey("Novo Nordisk", "Novo (company)")).toBe(false);
    expect(titleMatchesKey("Nestlé", "Laurent Freixe")).toBe(false);
  });
});

describe("articleFor", () => {
  it("picks the closest cited article, English first", () => {
    const urls = [
      "https://en.wikipedia.org/wiki/Nestl%C3%A9_India",
      "https://www.nestle.com/about",
      "https://de.wikipedia.org/wiki/Nestl%C3%A9",
      "https://en.wikipedia.org/wiki/Nestl%C3%A9",
    ];
    expect(articleFor("Nestlé", urls)).toEqual({ lang: "en", title: "Nestlé" });
  });
  it("skips non-article pages and unrelated articles", () => {
    expect(articleFor("Ferrari", ["https://en.wikipedia.org/wiki/List_of_largest_Italian_companies"])).toBeNull();
    expect(articleFor("Apple", ["https://en.wikipedia.org/wiki/Category:Apple"])).toBeNull();
  });
});

const value = (v: string, extra: Record<string, unknown> = {}) => ({ mainsnak: { datavalue: { value: v } }, rank: "normal", ...extra });
const german = { qualifiers: { P407: [{ datavalue: { value: { id: "Q188" } } }] } };

describe("linksFromClaims", () => {
  it("takes the one main value per property, as a full URL", () => {
    const links = linksFromClaims({
      P856: [value("https://old.example", { qualifiers: { P582: [] } }), value("https://www.example.com"), value("https://example.com/de/", german)],
      P4264: [value("example")],
      P2002: [{ mainsnak: {} }],
    });
    expect(links).toEqual([
      { label: "official website", url: "https://www.example.com" },
      { label: "LinkedIn page", url: "https://www.linkedin.com/company/example" },
    ]);
  });
  it("prefers the preferred statement, and gives none when Wikidata doesn't say which", () => {
    expect(linksFromClaims({ P4264: [value("a"), value("b", { rank: "preferred" })] })).toEqual([
      { label: "LinkedIn page", url: "https://www.linkedin.com/company/b" },
    ]);
    // Two pages Wikidata doesn't rank or place: no answer.
    expect(linksFromClaims({ P4264: [value("a-one"), value("a-two")] })).toEqual([]);
    // Toyota: the preferred site wins even in another language; country sites never do.
    const japanese = { rank: "preferred", qualifiers: { P407: [{ datavalue: { value: { id: "Q5287" } } }] } };
    const usa = { qualifiers: { P407: [{ datavalue: { value: { id: "Q1860" } } }], P1001: [] } };
    expect(
      linksFromClaims({ P856: [value("https://www.toyota.com/", usa), value("https://global.toyota", japanese)] }),
    ).toEqual([{ label: "official website", url: "https://global.toyota" }]);
    // Several addresses on one site are one answer.
    expect(linksFromClaims({ P856: [value("https://global.toyota/en/"), value("https://global.toyota")] })).toEqual([
      { label: "official website", url: "https://global.toyota" },
    ]);
  });
  it("falls back to the US version, then the EU / Europe one, for regional pages", () => {
    const country = (id: string) => ({ qualifiers: { P1001: [{ datavalue: { value: { id } } }] } });
    // Toyota's LinkedIn: dealer pages per country, one for Europe, none for the US.
    expect(
      linksFromClaims({
        P4264: [value("toyotazimbabwe", country("Q954")), value("toyota-motor-europe", country("Q46")), value("sverige.toyota", country("Q34"))],
        P2002: [value("toyota_europe", country("Q46")), value("toyota", country("Q30"))],
      }),
    ).toEqual([
      { label: "LinkedIn page", url: "https://www.linkedin.com/company/toyota-motor-europe", region: "Europe" },
      { label: "X (Twitter) account", url: "https://x.com/toyota", region: "the United States" },
    ]);
    expect(linksFromClaims({ P4264: [value("toyotazimbabwe", country("Q954")), value("sverige.toyota", country("Q34"))] })).toEqual([]);
  });
});

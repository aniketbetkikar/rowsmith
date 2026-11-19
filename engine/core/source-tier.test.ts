import { describe, expect, it } from "vitest";
import { entityHosts, hostOf, sourceTier } from "./source-tier";

const row = (key: string, input: Record<string, string> = {}) => ({ key, input: { name: key, ...input } });

describe("hostOf", () => {
  it("returns the lowercase host without www for URLs and bare domains", () => {
    expect(hostOf("https://WWW.Notion.com/about?x=1")).toBe("notion.com");
    expect(hostOf("zerodha.com")).toBe("zerodha.com");
  });
  it("returns null for values that aren't URLs or domains", () => {
    expect(hostOf("Notion Labs Inc.")).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("entityHosts", () => {
  it("collects domains from any of the row's own columns", () => {
    expect(entityHosts(row("Acme", { website: "https://www.acme.io/", city: "Pune" }))).toEqual(["acme.io"]);
  });
});

describe("sourceTier", () => {
  it("marks the entity's own site official (from a row URL or the key name)", () => {
    expect(sourceTier("docs.acme.io", row("Acme Corp", { website: "acme.io" }))).toBe("official");
    expect(sourceTier("notion.com", row("Notion"))).toBe("official");
    expect(sourceTier("support.zerodha.com", row("Zerodha"))).toBe("official");
  });

  it("doesn't treat a domain that merely contains the name as official", () => {
    expect(sourceTier("notionhub.com", row("Notion"))).toBe("web");
    expect(sourceTier("ai.com", row("AI"))).toBe("web");
  });

  it("marks government, academic and international bodies as authority", () => {
    for (const host of ["sec.gov", "mit.edu", "who.int", "india.gov.in", "ox.ac.uk", "insee.gouv.fr", "ec.europa.eu"]) {
      expect(sourceTier(host, row("X"))).toBe("authority");
    }
  });

  it("only reads gov/ac/go second-level labels under a country TLD", () => {
    expect(sourceTier("abc.go.com", row("X"))).toBe("web");
    expect(sourceTier("digital.go.jp", row("X"))).toBe("authority");
  });

  it("marks forums, social and user-generated sites as community", () => {
    expect(sourceTier("www.reddit.com", row("X"))).toBe("community");
    expect(sourceTier("someone.medium.com", row("X"))).toBe("community");
  });

  it("falls back to web, also when the host is unknown", () => {
    expect(sourceTier("forbes.com", row("X"))).toBe("web");
    expect(sourceTier(null, row("X"))).toBe("web");
  });

  it("ranks Wikipedia, Wikidata and the job's trusted sites as reference", () => {
    expect(sourceTier("en.wikipedia.org", row("X"))).toBe("reference");
    expect(sourceTier("www.wikidata.org", row("X"))).toBe("reference");
    expect(sourceTier("www.nseindia.com", row("X"), { trusted: ["nseindia.com"] })).toBe("reference");
    // A trusted platform outranks the community default.
    expect(sourceTier("www.linkedin.com", row("X"), { trusted: ["linkedin.com"] })).toBe("reference");
  });

  it("treats a confirmed official host and accented names as official", () => {
    expect(sourceTier("global.toyota", row("Toyota"), { official: ["global.toyota"] })).toBe("official");
    expect(sourceTier("www.nestle.com", row("Nestlé"))).toBe("official");
  });
});

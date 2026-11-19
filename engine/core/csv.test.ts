import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    expect(parseCsv("name,city\nNotion,San Francisco\nZerodha,Bengaluru\n")).toEqual({
      headers: ["name", "city"],
      rows: [
        { name: "Notion", city: "San Francisco" },
        { name: "Zerodha", city: "Bengaluru" },
      ],
    });
  });

  it("handles quotes, embedded commas and newlines", () => {
    const { rows } = parseCsv('name,note\n"Acme, Inc.","line 1\nline 2"\n');
    expect(rows).toEqual([{ name: "Acme, Inc.", note: "line 1\nline 2" }]);
  });

  it("strips a UTF-8 BOM and trims headers and cells", () => {
    const { headers, rows } = parseCsv(`${String.fromCharCode(0xfeff)} name , city\n Notion , SF \n`);
    expect(headers).toEqual(["name", "city"]);
    expect(rows).toEqual([{ name: "Notion", city: "SF" }]);
  });

  it("skips blank lines and pads short rows", () => {
    const { rows } = parseCsv("name,city\n\nNotion\n\n");
    expect(rows).toEqual([{ name: "Notion", city: "" }]);
  });

  it("returns no rows for a header-only file", () => {
    expect(parseCsv("name,city\n").rows).toEqual([]);
  });

  it("rejects empty input, blank or duplicate headers, and extra cells", () => {
    expect(() => parseCsv("")).toThrow(CsvError);
    expect(() => parseCsv("name,,city\na,b,c")).toThrow(/empty header/);
    expect(() => parseCsv("name,name\na,b")).toThrow(/Duplicate column header "name"/);
    expect(() => parseCsv("name\na,b")).toThrow(/Row 2 has 2 cells/);
  });
});

describe("toCsv", () => {
  it("serialises in header order and fills missing cells", () => {
    expect(toCsv(["b", "a"], [{ a: "1", b: "2" }, { a: "3" }])).toBe("b,a\r\n2,1\r\n,3");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(toCsv(["x"], [{ x: 'say "hi", ok' }])).toBe('x\r\n"say ""hi"", ok"');
  });

  it("escapes formula-like cells but keeps negative numbers", () => {
    const csv = toCsv(["x"], [{ x: "=HYPERLINK(1)" }, { x: "@cmd" }, { x: "-5" }, { x: "-x" }]);
    const cells = csv.split("\r\n").slice(1);
    expect(cells[0]).toContain("'=HYPERLINK(1)");
    expect(cells[1]).toContain("'@cmd");
    expect(cells[2]).toBe("-5");
    expect(cells[3]).toContain("'-x");
  });

  it("round-trips through parseCsv", () => {
    const headers = ["name", "note"];
    const rows = [{ name: "Acme, Inc.", note: 'a "quoted"\nvalue' }];
    expect(parseCsv(toCsv(headers, rows))).toEqual({ headers, rows });
  });
});

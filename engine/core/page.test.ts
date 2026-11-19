import { describe, expect, it } from "vitest";
import { decodeEntities, fetchPage, pageLinks, pageNames, type FetchLike } from "./page";

describe("pageNames", () => {
  it("reads the title and site-name metas, entities decoded", () => {
    const html =
      '<head><title>\n  Ben &amp; Jerry&#39;s </title><meta property="og:site_name" content="Ben &amp; Jerry\'s">' +
      "<meta name='description' content='ignored'></head>";
    expect(pageNames(html)).toEqual(["Ben & Jerry's", "Ben & Jerry's"]);
  });
});

describe("pageLinks", () => {
  it("resolves relative links and drops non-web ones", () => {
    const html = '<a href="/about">a</a><a class=x href=https://x.com/acme>b</a><a href="mailto:a@b.c">c</a><a href="/about">dup</a>';
    expect(pageLinks(html, "https://acme.com/")).toEqual(["https://acme.com/about", "https://x.com/acme"]);
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Nestl&eacute; &#x4E2D; &#169; &amp;")).toBe("Nestl&eacute; 中 © &");
  });
});

describe("fetchPage", () => {
  it("returns null on errors and non-2xx responses", async () => {
    const notFound = (async () => new Response("x", { status: 404 })) as FetchLike;
    const broken = (async () => {
      throw new Error("down");
    }) as FetchLike;
    expect(await fetchPage("https://a.com/", notFound)).toBeNull();
    expect(await fetchPage("https://a.com/", broken)).toBeNull();
  });
  it("caps the body size", async () => {
    const big = (async () => new Response("a".repeat(5000))) as FetchLike;
    const page = await fetchPage("https://a.com/", big, { maxBytes: 100 });
    expect(page?.url).toBe("https://a.com/");
    expect(page && page.body.length).toBeLessThan(5000);
  });
});

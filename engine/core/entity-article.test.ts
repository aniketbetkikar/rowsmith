import { describe, expect, it } from "vitest";
import { agreesWithRow, findArticle, ownHosts, rowFacts } from "./entity-article";
import type { FetchLike } from "./page";
import type { Grounding } from "./search";

const config = { keyColumn: "title" };

function fakeFetch(pages: Record<string, string>): FetchLike {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const hit = Object.entries(pages).find(([prefix]) => url.startsWith(prefix));
    return hit ? new Response(hit[1]) : new Response("", { status: 404 });
  }) as FetchLike;
}

const noSources: Grounding = { notes: "", sources: [], claims: [] };
const searchApi = "https://en.wikipedia.org/w/api.php?action=query&list=search";
const results = (...titles: string[]) => JSON.stringify({ query: { search: titles.map((title) => ({ title })) } });

describe("rowFacts and ownHosts", () => {
  it("takes the row's own values, not the key, URLs or tiny ones", () => {
    const row = { key: "Greatest Hits", input: { title: "Greatest Hits", artist: "Queen", tracks: "17", site: "queenonline.com" } };
    expect(rowFacts(config, row)).toEqual(["Queen"]);
    expect(ownHosts(row, noSources)).toEqual(["queenonline.com"]);
  });
});

describe("agreesWithRow", () => {
  it("needs a link to the entity's own site when one is known", () => {
    expect(agreesWithRow('<a href="https://www.apple.com/">apple.com</a>', [], ["apple.com"], false)).toBe(true);
    expect(agreesWithRow("<p>The apple is a fruit grown in the United States.</p>", ["United States"], ["apple.com"], true)).toBe(false);
  });
  it("otherwise needs the row's values: two, or the only one", () => {
    expect(agreesWithRow("<p>Greatest Hits is a 1981 album by Queen.</p>", ["Queen"], [], false)).toBe(true);
    expect(agreesWithRow("<p>An album by ABBA.</p>", ["Queen"], [], false)).toBe(false);
    expect(agreesWithRow("<p>A bluebell of the family Asparagaceae.</p>", ["Asparagaceae", "Scotland"], [], false)).toBe(false);
  });
  it("accepts a cited article with nothing to check against, never a looked-up one", () => {
    expect(agreesWithRow("<p>Anything.</p>", [], [], true)).toBe(true);
    expect(agreesWithRow("<p>Anything.</p>", [], [], false)).toBe(false);
  });
});

describe("findArticle", () => {
  it("looks up an uncited article and keeps the one that agrees with the row", async () => {
    const row = { key: "Greatest Hits", input: { title: "Greatest Hits", artist: "Queen" } };
    const fetchImpl = fakeFetch({
      [searchApi]: results("Greatest Hits (ABBA album)", "Greatest Hits (Queen album)"),
      "https://en.wikipedia.org/wiki/Greatest_Hits_(ABBA_album)": "<p>A compilation album by ABBA, released in 1975.</p>",
      "https://en.wikipedia.org/wiki/Greatest_Hits_(Queen_album)": "<p>Greatest Hits is a compilation album by Queen, released in 1981.</p>",
    });
    const article = await findArticle(noSources, config, row, fetchImpl);
    expect(article?.title).toBe("Greatest Hits (Queen album)");
  });

  it("rejects a cited article that doesn't link to the entity's own site", async () => {
    const row = { key: "Apple", input: { name: "Apple" } };
    const grounding: Grounding = {
      notes: "",
      claims: [],
      sources: [
        { url: "https://www.apple.com/newsroom/", title: "Apple", tier: "official" },
        { url: "https://en.wikipedia.org/wiki/Apple", title: "Apple - Wikipedia", tier: "reference" },
      ],
    };
    const fruit = fakeFetch({ "https://en.wikipedia.org/wiki/Apple": "<p>An apple is a round edible fruit.</p>" });
    expect(await findArticle(grounding, { keyColumn: "name" }, row, fruit)).toBeNull();
  });

  it("doesn't look anything up when the row has nothing to check against", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response("", { status: 404 });
    }) as FetchLike;
    expect(await findArticle(noSources, config, { key: "Springfield", input: { title: "Springfield" } }, counting)).toBeNull();
    expect(calls).toBe(0);
  });
});

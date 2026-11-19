import { describe, expect, it } from "vitest";
import { bodyPassages, infoboxRows } from "./page-text";

const wiki = `
<html><head><title>Apple Inc. - Wikipedia</title><script>var x = "Number of employees: 1";</script></head>
<body>
<nav><a href="/">Main page</a> Navigation menu with plenty of links here</nav>
<main>
<table class="infobox ib-company vcard"><tbody>
<tr><th colspan="2">Apple Inc.</th></tr>
<tr><th scope="row">Founded</th><td>April 1, 1976<span>; 50 years ago</span><sup class="reference">[1]</sup></td></tr>
<tr><th scope="row">Founders</th><td><ul><li>Steve Jobs</li><li>Steve Wozniak</li><li>Ronald Wayne</li></ul></td></tr>
<tr><th scope="row">Number of employees</th><td>166,000<sup>[2]</sup> (2025)</td></tr>
<tr><th scope="row">Website</th><td><a href="https://www.apple.com">apple.com</a></td></tr>
</tbody></table>
<p><b>Apple Inc.</b> is an American multinational technology company headquartered in Cupertino, California.<sup>[3]</sup> It is best known for its consumer electronics &amp; software.</p>
<table><tr><td>Revenue</td><td>US$416.2 billion</td></tr></table>
<p>Short.</p>
</main>
<footer>Privacy policy and terms of use for this website</footer>
</body></html>`;

describe("infoboxRows", () => {
  it("reads label: value rows, lists joined, footnotes dropped", () => {
    expect(infoboxRows(wiki)).toEqual([
      "Founded: April 1, 1976; 50 years ago",
      "Founders: Steve Jobs; Steve Wozniak; Ronald Wayne",
      "Number of employees: 166,000 (2025)",
      "Website: apple.com",
    ]);
  });
  it("is empty without an infobox", () => {
    expect(infoboxRows("<p>No box here at all, just text.</p>")).toEqual([]);
  });
});

describe("bodyPassages", () => {
  it("keeps the page's own words, without scripts, navigation, footers or the infobox", () => {
    const passages = bodyPassages(wiki);
    expect(passages).toContain(
      "Apple Inc. is an American multinational technology company headquartered in Cupertino, California. It is best known for its consumer electronics & software.",
    );
    expect(passages).toContain("Revenue | US$416.2 billion");
    const all = passages.join(" ");
    expect(all).not.toContain("Number of employees");
    expect(all).not.toContain("Navigation menu");
    expect(all).not.toContain("Privacy policy");
    expect(all).not.toContain("Short.");
  });
  it("splits very long paragraphs into sentences", () => {
    const sentence = "Acme makes rockets and sells them to many customers around the world every year. ";
    const passages = bodyPassages(`<p>${sentence.repeat(10)}</p>`);
    expect(passages).toEqual([sentence.trim()]);
  });
});

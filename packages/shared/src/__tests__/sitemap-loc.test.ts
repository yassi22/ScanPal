import { describe, it, expect } from "vitest";
import { extractSitemapLocs } from "../sitemap-loc";

describe("extractSitemapLocs", () => {
  it("extraheert en trimt <loc>-waarden uit een urlset", () => {
    const xml = `<urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>  https://example.com/about  </loc></url>
    </urlset>`;
    expect(extractSitemapLocs(xml)).toEqual([
      "https://example.com/",
      "https://example.com/about",
    ]);
  });

  it("werkt ook op een sitemapindex", () => {
    const xml = `<sitemapindex><sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap></sitemapindex>`;
    expect(extractSitemapLocs(xml)).toEqual([
      "https://example.com/sitemap-1.xml",
    ]);
  });

  it("slaat lege en whitespace-only <loc>-waarden over", () => {
    const xml = `<urlset><url><loc></loc></url><url><loc>   </loc></url><url><loc>https://example.com/x</loc></url></urlset>`;
    expect(extractSitemapLocs(xml)).toEqual(["https://example.com/x"]);
  });

  it("respecteert de limiet", () => {
    const xml = Array.from(
      { length: 10 },
      (_, i) => `<loc>https://example.com/${i}</loc>`,
    ).join("");
    expect(extractSitemapLocs(xml, 3)).toHaveLength(3);
  });

  it(
    "is lineair op een pathologische input (geen ReDoS)",
    { timeout: 1000 },
    () => {
      // Oude regex `<loc>\s*([^<]+?)\s*<\/loc>` had kubisch backtracking:
      // deze input liet de worker minuten hangen. `[^<]*` matcht lineair,
      // dus dit keert vrijwel direct terug met een lege lijst (geen sluittag).
      const evil = `<loc>${" ".repeat(50_000)}`;
      expect(extractSitemapLocs(evil)).toEqual([]);
    },
  );
});

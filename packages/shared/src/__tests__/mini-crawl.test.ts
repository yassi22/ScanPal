import { describe, it, expect } from "vitest";
import {
  extractImages,
  auditImageAlts,
  detectOrphanPages,
  orphanPagesFromHomeHtml,
  miniCrawlEvidence,
  miniCrawlEvidenceSchema,
} from "../mini-crawl";
import { checkCatalog } from "../check-catalog";

describe("mini-crawl (feature 38)", () => {
  it("heeft de catalog-entry mini-crawl (categorie seo, passief)", () => {
    const entry = checkCatalog.find((c) => c.id === "mini-crawl");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("seo");
    expect(entry?.active).toBe(false);
  });

  describe("extractImages", () => {
    it("leest src + alt uit een <img>-tag", () => {
      const imgs = extractImages(`<img src="/a.png" alt="Alpha"><img src="b.jpg" alt="">`);
      expect(imgs).toHaveLength(2);
      expect(imgs[0]).toEqual({ src: "/a.png", alt: "Alpha" });
      expect(imgs[1]).toEqual({ src: "b.jpg", alt: "" });
    });

    it("ondersteunt single-quote en unquoted attributen", () => {
      const imgs = extractImages(
        `<img src='/c.png' alt='Gamma'><img src=d.png alt=Delta>`,
      );
      expect(imgs).toHaveLength(2);
      expect(imgs[0]).toEqual({ src: "/c.png", alt: "Gamma" });
      expect(imgs[1]).toEqual({ src: "d.png", alt: "Delta" });
    });

    it("geeft alt: null als het attribuut ontbreekt", () => {
      const imgs = extractImages(`<img src="/e.png">`);
      expect(imgs).toEqual([{ src: "/e.png", alt: null }]);
    });

    it("negeert niet-img-tags met het woord img erin", () => {
      const imgs = extractImages(`<image src="/f.png"><img src="/g.png" alt="G">`);
      // <image> matcht niet op \bimg\b (woordgrens), alleen echte <img>-tags.
      expect(imgs).toHaveLength(1);
      expect(imgs[0].alt).toBe("G");
    });
  });

  describe("auditImageAlts", () => {
    it("telt images zonder alt-attribuut als missing", () => {
      const audit = auditImageAlts(
        `<img src="/a.png" alt="A"><img src="/b.png"><img src="/c.png" alt="">`,
      );
      expect(audit.total).toBe(3);
      expect(audit.missing).toBe(1);
      expect(audit.samples).toEqual(["/b.png"]);
    });

    it("lege alt (\"\") telt niet als missing (decoratief)", () => {
      const audit = auditImageAlts(`<img src="/x.png" alt="">`);
      expect(audit.missing).toBe(0);
      expect(audit.total).toBe(1);
    });

    it("capteert samples op maximaal 10", () => {
      const html = Array.from({ length: 15 }, (_, i) => `<img src="/${i}.png">`).join("");
      const audit = auditImageAlts(html);
      expect(audit.total).toBe(15);
      expect(audit.missing).toBe(15);
      expect(audit.samples).toHaveLength(10);
    });

    it("levert lege samples bij geen images", () => {
      const audit = auditImageAlts(`<html><body>geen plaatjes</body></html>`);
      expect(audit.total).toBe(0);
      expect(audit.missing).toBe(0);
      expect(audit.samples).toEqual([]);
    });
  });

  describe("detectOrphanPages", () => {
    it("markeert sitemap-routes die niet intern gelinkt zijn", () => {
      const result = detectOrphanPages(
        ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
        ["https://example.com/a", "https://example.com/b"],
      );
      expect(result.sitemap_count).toBe(3);
      expect(result.orphan_count).toBe(1);
      expect(result.samples).toEqual(["https://example.com/c"]);
    });

    it("geen orphans als alles gelinkt is", () => {
      const result = detectOrphanPages(
        ["https://example.com/a", "https://example.com/b"],
        ["https://example.com/a", "https://example.com/b"],
      );
      expect(result.orphan_count).toBe(0);
      expect(result.samples).toEqual([]);
    });

    it("capteert orphan-samples op maximaal 10", () => {
      const sitemap = Array.from({ length: 15 }, (_, i) => `https://example.com/r${i}`);
      const result = detectOrphanPages(sitemap, []);
      expect(result.orphan_count).toBe(15);
      expect(result.samples).toHaveLength(10);
    });
  });

  describe("orphanPagesFromHomeHtml", () => {
    it("combineert homepage-links met sitemap-routes", () => {
      const homeHtml = `
        <a href="https://example.com/a">A</a>
        <a href="/b">B</a>
        <a href="https://other.com/x">external</a>
      `;
      const result = orphanPagesFromHomeHtml(homeHtml, "https://example.com/", [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/orphan",
      ]);
      expect(result.sitemap_count).toBe(3);
      // /a en /b zijn gelinkt vanaf homepage; /orphan niet.
      expect(result.orphan_count).toBe(1);
      expect(result.samples).toEqual(["https://example.com/orphan"]);
    });

    it("homepage zelf (root) wordt correct behandeld", () => {
      const homeHtml = `<a href="/">home</a><a href="/about">about</a>`;
      const result = orphanPagesFromHomeHtml(homeHtml, "https://example.com/", [
        "https://example.com/",
        "https://example.com/about",
      ]);
      expect(result.orphan_count).toBe(0);
    });
  });

  describe("miniCrawlEvidence", () => {
    it("bouwt een geldig evidence-object met kind mini-crawl", () => {
      const evidence = miniCrawlEvidence(
        { total: 5, missing: 2, samples: ["/a.png", "/b.png"] },
        { sitemap_count: 10, orphan_count: 3, samples: ["/o1", "/o2", "/o3"] },
      );
      expect(evidence.kind).toBe("mini-crawl");
      expect(evidence.image_audit).toEqual({ total: 5, missing: 2, samples: ["/a.png", "/b.png"] });
      expect(evidence.orphan_pages).toEqual({
        sitemap_count: 10,
        orphan_count: 3,
        samples: ["/o1", "/o2", "/o3"],
      });

      // Schema validatie
      const parsed = miniCrawlEvidenceSchema.safeParse(evidence);
      expect(parsed.success).toBe(true);
    });
  });
});

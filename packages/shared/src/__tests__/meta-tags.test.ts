import { describe, it, expect } from "vitest";
import {
  evaluateMetaTags,
  extractMetaTags,
  metaTagsEvidence,
  META_FIELDS,
} from "../meta-tags";

function fullHtml(head = ""): string {
  return `<!doctype html><html><head>${head}</head><body><main>x</main></body></html>`;
}

describe("extractMetaTags", () => {
  it("detecteert een complete pagina", () => {
    const html = fullHtml(`
      <title>Mijn pagina</title>
      <meta name="description" content="Een mooie beschrijving">
      <meta property="og:title" content="Mijn pagina">
      <meta property="og:description" content="OG beschrijving">
      <meta property="og:image" content="https://example.com/og.png">
      <link rel="canonical" href="https://example.com/pagina">
      <link rel="alternate" hreflang="en" href="https://example.com/en/pagina">
      <link rel="alternate" hreflang="nl" href="https://example.com/pagina">
    `);
    const result = extractMetaTags(html);
    expect(result.present).toEqual(META_FIELDS);
    expect(result.missing).toEqual([]);
    expect(result.values.title).toBe("Mijn pagina");
    expect(result.values.description).toBe("Een mooie beschrijving");
    expect(result.values["og:image"]).toBe("https://example.com/og.png");
    expect(result.values.canonical).toBe("https://example.com/pagina");
    expect(result.values.hreflang).toBe("2 alternate-link(s)");
  });

  it("markeert ontbrekende velden als missing", () => {
    const html = fullHtml(`<title>Alleen titel</title>`);
    const result = extractMetaTags(html);
    expect(result.present).toEqual(["title"]);
    expect(result.missing).toEqual([
      "description",
      "og:title",
      "og:description",
      "og:image",
      "canonical",
      "hreflang",
    ]);
  });

  it("leest meta-tags in beide attribute-quoting-stijlen", () => {
    const html = fullHtml(`
      <meta name='description' content='Enkele quotes'>
      <meta property="og:title" content='Gemengd'>
    `);
    const result = extractMetaTags(html);
    expect(result.values.description).toBe("Enkele quotes");
    expect(result.values["og:title"]).toBe("Gemengd");
  });

  it("decodeert HTML-entities in titel en content", () => {
    const html = fullHtml(`<title>Tom &amp; Jerry &lt;3</title>`);
    const result = extractMetaTags(html);
    expect(result.values.title).toBe("Tom & Jerry <3");
  });

  it("telt RSS/atom-feed-links niet als hreflang (geen hreflang-attr)", () => {
    const html = fullHtml(`
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="alternate" hreflang="en" href="https://example.com/en">
    `);
    const result = extractMetaTags(html);
    expect(result.values.hreflang).toBe("1 alternate-link(s)");
  });

  it("negeert lege title-tag", () => {
    const html = fullHtml(`<title>   </title>`);
    const result = extractMetaTags(html);
    expect(result.missing).toContain("title");
  });
});

describe("evaluateMetaTags", () => {
  it("fail als title ontbreekt", () => {
    const result = extractMetaTags(fullHtml(""));
    const { status } = evaluateMetaTags(result);
    expect(status).toBe("fail");
  });

  it("warn als description ontbreekt", () => {
    const html = fullHtml(`
      <title>Pagina</title>
      <link rel="canonical" href="https://example.com/x">
    `);
    const { status, detail } = evaluateMetaTags(extractMetaTags(html));
    expect(status).toBe("warn");
    expect(detail).toContain("description");
  });

  it("warn als canonical ontbreekt", () => {
    const html = fullHtml(`
      <title>Pagina</title>
      <meta name="description" content="Beschrijving">
    `);
    const { status, detail } = evaluateMetaTags(extractMetaTags(html));
    expect(status).toBe("warn");
    expect(detail).toContain("canonical");
  });

  it("pass als title + description + canonical aanwezig (zonder extras)", () => {
    const html = fullHtml(`
      <title>Pagina</title>
      <meta name="description" content="Beschrijving">
      <link rel="canonical" href="https://example.com/x">
    `);
    const { status, detail } = evaluateMetaTags(extractMetaTags(html));
    expect(status).toBe("pass");
    expect(detail).toContain("canonical aanwezig");
  });

  it("pass met extras vermeldt de OG/hreflang-tags", () => {
    const html = fullHtml(`
      <title>Pagina</title>
      <meta name="description" content="Beschrijving">
      <link rel="canonical" href="https://example.com/x">
      <meta property="og:title" content="P">
      <link rel="alternate" hreflang="en" href="https://example.com/en">
    `);
    const { status, detail } = evaluateMetaTags(extractMetaTags(html));
    expect(status).toBe("pass");
    expect(detail).toContain("og:title");
    expect(detail).toContain("hreflang");
  });
});

describe("metaTagsEvidence", () => {
  it("bouwt een evidence-object met kind meta-tags", () => {
    const html = fullHtml(`<title>X</title>`);
    const evidence = metaTagsEvidence(extractMetaTags(html));
    expect(evidence.kind).toBe("meta-tags");
    expect(evidence.present).toContain("title");
    expect(evidence.missing).toContain("description");
    expect(evidence.values.title).toBe("X");
  });
});

import { describe, it, expect } from "vitest";
import {
  extractServerProbe,
  parseRenderProbe,
  parseRenderCompare,
  renderCompareEvidence,
  renderOverallStatus,
  textRatio,
  renderCompareEvidenceSchema,
  renderCompareCaptureSchema,
  type RenderCompareCapture,
} from "../aeo-render";

function capture(server: Partial<RenderCompareCapture["server"]>, rendered: Partial<RenderCompareCapture["rendered"]>): RenderCompareCapture {
  const base = { text_length: 0, heading_count: 0, title: null, meta_description: null, link_count: 0 };
  return { server: { ...base, ...server }, rendered: { ...base, ...rendered } };
}

describe("extractServerProbe (raw server-HTML)", () => {
  it("leegte input → lege probe", () => {
    expect(extractServerProbe("")).toEqual({
      text_length: 0,
      heading_count: 0,
      title: null,
      meta_description: null,
      link_count: 0,
    });
  });

  it("verwijdert scripts en styles uit de zichtbare tekst", () => {
    const html =
      "<html><head><title>Test titel</title>" +
      "<meta name=\"description\" content=\"Korte omschrijving\"></head>" +
      "<body><h1>Welkom</h1><p>Hallo wereld</p>" +
      "<script>var x = 'geen tekst';</script>" +
      "<style>.a{color:red}</style></body></html>";
    const probe = extractServerProbe(html);
    expect(probe.title).toBe("Test titel");
    expect(probe.meta_description).toBe("Korte omschrijving");
    expect(probe.heading_count).toBe(1);
    expect(probe.link_count).toBe(0);
    expect(probe.text_length).toBe("Welkom Hallo wereld".length);
  });

  it("telt headings en anchors met href", () => {
    const html =
      "<body><h1>H1</h1><h2 class=\"x\">H2</h2><h6>H6</h6>" +
      "<a href=\"/a\">a</a><a id=\"b\" href=\"/b\">b</a>" +
      "<a name=\"anchor\">geen href</a></body>";
    const probe = extractServerProbe(html);
    expect(probe.heading_count).toBe(3);
    expect(probe.link_count).toBe(2);
  });

  it("decodeert HTML-entities in titel en meta", () => {
    const html =
      "<title>Foo &amp; Bar &lt;x&gt; &#39;q&#39; &quot;d&quot;</title>" +
      "<meta name=\"description\" content=\"a &amp; b\">";
    const probe = extractServerProbe(html);
    expect(probe.title).toBe("Foo & Bar <x> 'q' \"d\"");
    expect(probe.meta_description).toBe("a & b");
  });

  it("geeft null bij lege/ontbrekende titel en meta", () => {
    const probe = extractServerProbe("<body><p>geen titel</p></body>");
    expect(probe.title).toBeNull();
    expect(probe.meta_description).toBeNull();
  });

  it("vindt meta-description ongeacht attribute-volgorde", () => {
    const html = "<meta content=\"andersom\" name=\"description\">";
    const probe = extractServerProbe(html);
    expect(probe.meta_description).toBe("andersom");
  });
});

describe("parseRenderProbe / parseRenderCompare", () => {
  it("parst geldige ruwe probes", () => {
    const probe = parseRenderProbe({
      text_length: 120,
      heading_count: 2,
      title: "T",
      meta_description: null,
      link_count: 5,
    });
    expect(probe).toEqual({ text_length: 120, heading_count: 2, title: "T", meta_description: null, link_count: 5 });
  });

  it("normaliseert ontbrekende text_length/heading_count → null", () => {
    expect(parseRenderProbe({ heading_count: 1, link_count: 1 })).toBeNull();
    expect(parseRenderProbe(null)).toBeNull();
    expect(parseRenderProbe("nope")).toBeNull();
  });

  it("parset een volledige render-vergelijking", () => {
    const result = parseRenderCompare({
      server: { text_length: 50, heading_count: 1, title: "S", meta_description: "m", link_count: 1 },
      rendered: { text_length: 400, heading_count: 3, title: "S", meta_description: "m", link_count: 4 },
    });
    expect(result?.server.text_length).toBe(50);
    expect(result?.rendered.text_length).toBe(400);
  });

  it("retourneert null bij een onvolledige vergelijking", () => {
    expect(parseRenderCompare({ server: { text_length: 1, heading_count: 0, title: null, meta_description: null, link_count: 0 } })).toBeNull();
    expect(parseRenderCompare(undefined)).toBeNull();
  });
});

describe("textRatio & renderOverallStatus", () => {
  it("pass bij vergelijkbare server- en DOM-tekst", () => {
    const c = capture({ text_length: 400 }, { text_length: 500 });
    expect(textRatio(c)).toBe(1.3);
    expect(renderOverallStatus(c)).toBe("pass");
  });

  it("fail bij SPA-shell: nagenoeg lege server-HTML, substantiële DOM", () => {
    const c = capture({ text_length: 50 }, { text_length: 1200 });
    expect(renderOverallStatus(c)).toBe("fail");
  });

  it("fail bij ratio ≥ 10 met niet-lege server-tekst", () => {
    const c = capture({ text_length: 150 }, { text_length: 1600 });
    expect(renderOverallStatus(c)).toBe("fail");
  });

  it("warn bij ratio ≥ 3 (grote JS-afhankelijkheid)", () => {
    const c = capture({ text_length: 200 }, { text_length: 800 });
    expect(renderOverallStatus(c)).toBe("warn");
  });

  it("warn bij JS-only-headings", () => {
    const c = capture({ heading_count: 0 }, { heading_count: 3 });
    expect(renderOverallStatus(c)).toBe("warn");
  });

  it("warn bij JS-only-titel of meta-description", () => {
    const c1 = capture({ title: null }, { title: "DOM-titel" });
    const c2 = capture({ meta_description: null }, { meta_description: "DOM-meta" });
    expect(renderOverallStatus(c1)).toBe("warn");
    expect(renderOverallStatus(c2)).toBe("warn");
  });

  it("pass als title/meta ook al in server-HTML staan", () => {
    const c = capture({ title: "T", meta_description: "M", heading_count: 1 }, { title: "T", meta_description: "M", heading_count: 1 });
    expect(renderOverallStatus(c)).toBe("pass");
  });
});

describe("renderCompareEvidence & schema", () => {
  it("bouwt evidence met ratio, delta en issues", () => {
    const c = capture({ text_length: 100, heading_count: 0 }, { text_length: 1500, heading_count: 2 });
    const evidence = renderCompareEvidence(c);
    expect(evidence.kind).toBe("aeo-render");
    expect(evidence.text_ratio).toBe(15);
    expect(evidence.content_delta).toBe(1400);
    expect(evidence.issues.length).toBeGreaterThan(0);
    expect(evidence.issues[0]).toContain("JavaScript");
    expect(evidence.issues.some((i) => i.includes("Headings"))).toBe(true);
  });

  it("levert een lege issues-lijst bij pass", () => {
    const c = capture({ text_length: 500, title: "T", meta_description: "M", heading_count: 1 }, { text_length: 550 });
    expect(renderCompareEvidence(c).issues).toEqual([]);
  });

  it("valideert via het evidence-schema", () => {
    const c = capture({ text_length: 500 }, { text_length: 550 });
    expect(renderCompareEvidenceSchema.safeParse(renderCompareEvidence(c)).success).toBe(true);
    expect(renderCompareCaptureSchema.safeParse(c).success).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  evaluateStructuredData,
  extractStructuredData,
  structuredDataEvidence,
} from "../structured-data";

describe("structured-data", () => {
  it("vindt en parseert geldig JSON-LD", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Organization","name":"Acme","url":"https://acme.example"}
      </script>
      <script type="application/ld+json">
        {"@type":"WebSite","name":"Acme Site"}
      </script>
    `;
    const { blocks, types } = extractStructuredData(html);
    expect(blocks.length).toBe(2);
    expect(blocks.every((b) => b.valid)).toBe(true);
    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
  });

  it("markeert ongeldig JSON-LD", () => {
    const html = `<script type="application/ld+json">{not valid json}</script>`;
    const { blocks } = extractStructuredData(html);
    expect(blocks.length).toBe(1);
    expect(blocks[0].valid).toBe(false);
  });

  it("evaluate: pass bij geldige bekende types", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>`;
    const { blocks, types } = extractStructuredData(html);
    const { status } = evaluateStructuredData(blocks, types);
    expect(status).toBe("pass");
  });

  it("evaluate: warn bij geen structured data", () => {
    const { blocks, types } = extractStructuredData("<html></html>");
    const { status } = evaluateStructuredData(blocks, types);
    expect(status).toBe("warn");
  });

  it("evaluate: fail bij ongeldig blok", () => {
    const html = `<script type="application/ld+json">{invalid}</script>`;
    const { blocks, types } = extractStructuredData(html);
    const { status } = evaluateStructuredData(blocks, types);
    expect(status).toBe("fail");
  });

  it("evaluate: warn bij onbekend @type", () => {
    const html = `<script type="application/ld+json">{"@type":"FakeType123"}</script>`;
    const { blocks, types } = extractStructuredData(html);
    const { status } = evaluateStructuredData(blocks, types);
    expect(status).toBe("warn");
  });

  it("structuredDataEvidence bouwt evidence", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization"}</script>
      <script type="application/ld+json">{bad}</script>`;
    const { blocks, types } = extractStructuredData(html);
    const ev = structuredDataEvidence(blocks, types);
    expect(ev.kind).toBe("structured-data");
    expect(ev.total).toBe(2);
    expect(ev.valid).toBe(1);
    expect(ev.invalid).toBe(1);
    expect(ev.types).toContain("Organization");
  });

  it("verwerkt @type als array", () => {
    const html = `<script type="application/ld+json">{"@type":["Organization","WebSite"]}</script>`;
    const { types } = extractStructuredData(html);
    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
  });
});

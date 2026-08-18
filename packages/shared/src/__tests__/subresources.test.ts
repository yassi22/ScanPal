import { describe, it, expect } from "vitest";
import {
  evaluateSubresources,
  extractSubresources,
  subresourcesEvidence,
} from "../subresources";

describe("subresources", () => {
  it("vindt externe scripts + stylesheets en integrity-attr", () => {
    const html = `
      <script src="https://cdn.example.com/a.js" integrity="sha384-abc" crossorigin></script>
      <script src="https://cdn.example.com/b.js"></script>
      <link rel="stylesheet" href="https://cdn.example.com/style.css" integrity="sha384-xyz">
      <script>inline</script>
      <script src="/local.js"></script>
    `;
    const items = extractSubresources(html, "https://site.example/");
    expect(items.length).toBe(3);
    expect(items[0].integrity).toBe(true);
    expect(items[1].integrity).toBe(false);
    expect(items[2].integrity).toBe(true);
  });

  it("evaluateSubresources: pass als alle integrity hebben", () => {
    const items = extractSubresources(
      `<script src="https://cdn.example.com/a.js" integrity="sha384-abc"></script>`,
      "https://site.example/",
    );
    const { status, detail } = evaluateSubresources(items);
    expect(status).toBe("pass");
    expect(detail).toContain("integrity");
  });

  it("evaluateSubresources: warn als integrity mist", () => {
    const items = extractSubresources(
      `<script src="https://cdn.example.com/a.js"></script>`,
      "https://site.example/",
    );
    const { status } = evaluateSubresources(items);
    expect(status).toBe("warn");
  });

  it("evaluateSubresources: pass bij geen externe resources", () => {
    const items = extractSubresources(`<script>inline</script>`, "https://site.example/");
    const { status } = evaluateSubresources(items);
    expect(status).toBe("pass");
  });

  it("subresourcesEvidence bouwt evidence met missing_integrity", () => {
    const items = extractSubresources(
      `<script src="https://cdn.example.com/a.js"></script>`,
      "https://site.example/",
    );
    const ev = subresourcesEvidence(items);
    expect(ev.kind).toBe("subresources");
    expect(ev.total).toBe(1);
    expect(ev.with_integrity).toBe(0);
    expect(ev.missing_integrity.length).toBe(1);
  });

  it("same-origin script zonder integrity is geen SRI-missing (geen false positive)", () => {
    const items = extractSubresources(
      `<script src="https://site.example/app.js"></script>`,
      "https://site.example/",
    );
    expect(items[0]?.crossOrigin).toBe(false);
    expect(evaluateSubresources(items).status).toBe("pass");
    expect(subresourcesEvidence(items).missing_integrity.length).toBe(0);
  });
});

import { z } from "zod";

/**
 * Plan 34 — subresource-integriteit (SRI). Vindt externe js/css/img-resources
 * in de HTML en checkt of ze een `integrity`-attribuut hebben (Subresource
 * Integrity). Cross-origin resources zonder integrity zijn manipuleerbaar.
 */

export const subresourcesEvidenceSchema = z.object({
  kind: z.literal("subresources"),
  total: z.number().int(),
  with_integrity: z.number().int(),
  missing_integrity: z.array(
    z.object({
      tag: z.string(),
      attr: z.string(),
      url: z.string(),
      crossorigin: z.boolean(),
    }),
  ),
});
export type SubresourcesEvidence = z.infer<typeof subresourcesEvidenceSchema>;

export type Subresource = {
  tag: string;
  attr: string;
  url: string;
  integrity: boolean;
  crossorigin: boolean;
  /** Echt cross-origin t.o.v. de pagina (same-origin resources hoeven geen SRI). */
  crossOrigin: boolean;
};

const SUBRESOURCE_PATTERNS = [
  { tag: "script", attr: "src", re: /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi },
  { tag: "link", attr: "href", re: /<link\b[^>]*>/gi },
];

function isCrossOrigin(resourceUrl: string, pageUrl: string): boolean {
  try {
    const r = new URL(resourceUrl, pageUrl);
    const p = new URL(pageUrl);
    return r.protocol !== p.protocol || r.hostname !== p.hostname || r.port !== p.port;
  } catch {
    return true;
  }
}

export function extractSubresources(html: string, pageUrl: string): Subresource[] {
  const out: Subresource[] = [];
  for (const { tag, attr, re } of SUBRESOURCE_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const tagText = match[0];
      let url: string | null = null;
      if (tag === "link") {
        const relMatch = tagText.match(/\brel\s*=\s*["']([^"']*)["']/i);
        const relValue = relMatch?.[1]?.toLowerCase().trim() ?? "";
        if (!relValue.split(/\s+/).includes("stylesheet")) continue;
        const hrefMatch = tagText.match(/\bhref\s*=\s*["']([^"']+)["']/i);
        if (!hrefMatch) continue;
        url = hrefMatch[1];
      } else {
        url = match[1];
      }
      if (!url) continue;
      // Only external resources (skip inline + relative same-origin without origin)
      if (!/^https?:\/\//i.test(url)) continue;
      const integrity = /\bintegrity\s*=/i.test(tagText);
      const crossorigin = /\bcrossorigin\b/i.test(tagText);
      out.push({
        tag,
        attr,
        url: url.slice(0, 300),
        integrity,
        crossorigin,
        crossOrigin: isCrossOrigin(url, pageUrl),
      });
    }
  }
  return out;
}

export function subresourcesEvidence(resources: Subresource[]): SubresourcesEvidence {
  const missingIntegrity = resources
    .filter((r) => !r.integrity && r.crossOrigin)
    .map((r) => ({
      tag: r.tag,
      attr: r.attr,
      url: r.url,
      crossorigin: r.crossorigin,
    }));
  return {
    kind: "subresources",
    total: resources.length,
    with_integrity: resources.filter((r) => r.integrity).length,
    missing_integrity: missingIntegrity,
  };
}

export function evaluateSubresources(resources: Subresource[]): {
  status: "pass" | "warn" | "fail";
  detail: string;
} {
  const crossOrigin = resources.filter((r) => r.crossOrigin);
  if (crossOrigin.length === 0) {
    return { status: "pass", detail: "Geen cross-origin js/css-subresources gevonden" };
  }
  const missing = crossOrigin.filter((r) => !r.integrity);
  if (missing.length === 0) {
    return {
      status: "pass",
      detail: `${crossOrigin.length} cross-origin subresource(s), alle met integrity-attr (SRI)`,
    };
  }
  return {
    status: "warn",
    detail: `${missing.length} van ${crossOrigin.length} cross-origin subresource(s) mist integrity-attr (SRI)`,
  };
}

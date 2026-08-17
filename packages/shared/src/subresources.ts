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
};

const SUBRESOURCE_PATTERNS = [
  { tag: "script", attr: "src", re: /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi },
  { tag: "link", attr: "href", re: /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi },
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
      const url = match[1];
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
      });
      void isCrossOrigin(url, pageUrl);
    }
  }
  return out;
}

export function subresourcesEvidence(resources: Subresource[]): SubresourcesEvidence {
  const missingIntegrity = resources
    .filter((r) => !r.integrity && isCrossOriginSafe(r))
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

function isCrossOriginSafe(r: Subresource): boolean {
  // We report all external resources without integrity; cross-origin flag
  // is informational (CORS requirement for SRI enforcement).
  void r;
  return true;
}

export function evaluateSubresources(resources: Subresource[]): {
  status: "pass" | "warn" | "fail";
  detail: string;
} {
  if (resources.length === 0) {
    return { status: "pass", detail: "Geen externe js/css-subresources gevonden" };
  }
  const missing = resources.filter((r) => !r.integrity);
  if (missing.length === 0) {
    return {
      status: "pass",
      detail: `${resources.length} externe subresource(s), alle met integrity-attr`,
    };
  }
  return {
    status: "warn",
    detail: `${missing.length} van ${resources.length} externe subresource(s) mist integrity-attr (SRI)`,
  };
}

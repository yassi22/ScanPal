import { z } from "zod";

/**
 * Plan 39 — structured data (JSON-LD). Vindt <script type="application/ld+json">
 * blokken in de HTML, parset ze en valideert basis schema.org-vorm (@type
 * aanwezig, bekende types). Microdata/RDFa vallen buiten deze eerste versie.
 */

export const structuredDataEvidenceSchema = z.object({
  kind: z.literal("structured-data"),
  total: z.number().int(),
  valid: z.number().int(),
  invalid: z.number().int(),
  types: z.array(z.string()),
  errors: z.array(
    z.object({
      index: z.number().int(),
      error: z.string(),
    }),
  ),
});
export type StructuredDataEvidence = z.infer<typeof structuredDataEvidenceSchema>;

const KNOWN_TYPES = new Set([
  "Organization",
  "WebSite",
  "WebPage",
  "Article",
  "NewsArticle",
  "BlogPosting",
  "Product",
  "Offer",
  "BreadcrumbList",
  "Person",
  "LocalBusiness",
  "Event",
  "Place",
  "Review",
  "AggregateRating",
  "FAQPage",
  "HowTo",
  "Recipe",
  "VideoObject",
  "ImageObject",
  "SandboxEvent",
  "SoftwareApplication",
  "Course",
  "JobPosting",
  "Question",
  "Answer",
]);

export type ParsedBlock =
  | { valid: true; data: unknown; types: string[] }
  | { valid: false; error: string };

function extractBlocks(html: string): string[] {
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function parseBlock(text: string): ParsedBlock {
  const trimmed = text.trim();
  if (!trimmed) return { valid: false, error: "leeg JSON-LD blok" };
  try {
    const data = JSON.parse(trimmed);
    return { valid: true, data, types: collectTypes(data) };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "JSON-parse fout",
    };
  }
}

function collectTypes(data: unknown): string[] {
  const types: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj["@type"] === "string") {
        types.push(obj["@type"]);
      } else if (Array.isArray(obj["@type"])) {
        for (const t of obj["@type"]) if (typeof t === "string") types.push(t);
      }
      for (const value of Object.values(obj)) visit(value);
    }
  };
  visit(data);
  return types;
}

export function extractStructuredData(html: string): {
  blocks: ParsedBlock[];
  types: string[];
} {
  const rawBlocks = extractBlocks(html);
  const blocks = rawBlocks.map(parseBlock);
  const types = Array.from(
    new Set(blocks.flatMap((b) => (b.valid ? b.types : []))),
  );
  return { blocks, types };
}

export function structuredDataEvidence(
  blocks: ParsedBlock[],
  types: string[],
): StructuredDataEvidence {
  const errors: { index: number; error: string }[] = [];
  blocks.forEach((b, i) => {
    if (!b.valid) errors.push({ index: i, error: b.error });
  });
  return {
    kind: "structured-data",
    total: blocks.length,
    valid: blocks.filter((b) => b.valid).length,
    invalid: errors.length,
    types,
    errors,
  };
}

export function evaluateStructuredData(
  blocks: ParsedBlock[],
  types: string[],
): { status: "pass" | "warn" | "fail" | "info"; detail: string } {
  if (blocks.length === 0) {
    return {
      status: "warn",
      detail: "Geen JSON-LD structured data gevonden op de pagina",
    };
  }
  const invalid = blocks.filter((b) => !b.valid).length;
  const unknownTypes = types.filter((t) => !KNOWN_TYPES.has(t));
  if (invalid > 0) {
    return {
      status: "fail",
      detail: `${invalid} van ${blocks.length} JSON-LD blok(ken) is ongeldig`,
    };
  }
  if (types.length === 0) {
    return {
      status: "warn",
      detail: `${blocks.length} JSON-LD blok(ken) maar geen @type gevonden`,
    };
  }
  if (unknownTypes.length > 0) {
    return {
      status: "warn",
      detail: `${blocks.length} blok(ken), types: ${types.join(", ")} (onbekend: ${unknownTypes.join(", ")})`,
    };
  }
  return {
    status: "pass",
    detail: `${blocks.length} geldig JSON-LD blok(ken), types: ${types.join(", ")}`,
  };
}

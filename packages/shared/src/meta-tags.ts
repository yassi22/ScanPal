import { z } from "zod";

/**
 * Plan 35 — meta/OG/canonical/hreflang extractie + evaluatie. Pure logica
 * (geen fetch) zodat het testbaar is zonder netwerk; de worker-wrapper in
 * `apps/worker/src/checks/http/meta-tags.ts` haalt de HTML op en roept deze
 * helpers aan. Eén check-id `meta-tags` produceert één InlineCheckLike met een
 * `MetaTagsEvidence`-object (aanwezig/afwezig per veld + gevonden waarden).
 */

export const META_FIELDS = [
  "title",
  "description",
  "og:title",
  "og:description",
  "og:image",
  "canonical",
  "hreflang",
] as const;
export type MetaField = (typeof META_FIELDS)[number];

export const metaTagsEvidenceSchema = z.object({
  kind: z.literal("meta-tags"),
  present: z.array(z.string()),
  missing: z.array(z.string()),
  values: z.record(z.string(), z.string()),
});
export type MetaTagsEvidence = z.infer<typeof metaTagsEvidenceSchema>;

export type MetaTagResult = {
  present: MetaField[];
  missing: MetaField[];
  values: Partial<Record<MetaField, string>>;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function attrValue(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
}

/**
 * Haalt title, description, OG-tags, canonical en hreflang uit de pagina-HTML.
 * Hreflang wordt als één veld gerapporteerd (aantal alternate-links gevonden).
 */
export function extractMetaTags(html: string): MetaTagResult {
  const values: Partial<Record<MetaField, string>> = {};
  const present: MetaField[] = [];
  const missing: MetaField[] = [];

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title && title.trim()) {
    values.title = decodeEntities(title).slice(0, 200);
    present.push("title");
  } else {
    missing.push("title");
  }

  const desc = findMetaByName(html, "description");
  if (desc) {
    values.description = desc.slice(0, 300);
    present.push("description");
  } else {
    missing.push("description");
  }

  for (const property of ["og:title", "og:description", "og:image"] as const) {
    const value = findMetaByProperty(html, property);
    if (value) {
      values[property] = value.slice(0, 300);
      present.push(property);
    } else {
      missing.push(property);
    }
  }

  const canonical = findLinkRel(html, "canonical");
  if (canonical) {
    values.canonical = canonical.slice(0, 300);
    present.push("canonical");
  } else {
    missing.push("canonical");
  }

  const hreflangCount = countLinkRel(html, "alternate");
  if (hreflangCount > 0) {
    values.hreflang = `${hreflangCount} alternate-link(s)`;
    present.push("hreflang");
  } else {
    missing.push("hreflang");
  }

  return { present, missing, values };
}

function findMetaByName(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+name\\s*=\\s*["']${escapeRegex(name)}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  return attrValue(tag, "content");
}

function findMetaByProperty(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+property\\s*=\\s*["']${escapeRegex(property)}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  return attrValue(tag, "content");
}

function findLinkRel(html: string, rel: string): string | null {
  const re = new RegExp(
    `<link[^>]+rel\\s*=\\s*["']${escapeRegex(rel)}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  return attrValue(tag, "href");
}

function countLinkRel(html: string, rel: string): number {
  const re = new RegExp(
    `<link[^>]+rel\\s*=\\s*["']${escapeRegex(rel)}["'][^>]*>`,
    "gi",
  );
  return html.match(re)?.length ?? 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Status-bepaling: title is hard (warn als ontbreekt), description + canonical
 * zijn important (warn), OG-tags + hreflang zijn nice-to-have (info-only).
 * `pass` = title + description + canonical aanwezig; `warn` = één van die drie
 * ontbreekt; `fail` = title ontbreekt.
 */
export function evaluateMetaTags(result: MetaTagResult): {
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
} {
  const hasTitle = result.present.includes("title");
  const hasDesc = result.present.includes("description");
  const hasCanonical = result.present.includes("canonical");

  if (!hasTitle) {
    return {
      status: "fail",
      detail: "Pagina heeft geen <title> tag",
    };
  }

  const critical: string[] = [];
  if (!hasDesc) critical.push("description");
  if (!hasCanonical) critical.push("canonical");

  if (critical.length === 0) {
    const extras = result.present.filter(
      (f) => f !== "title" && f !== "description" && f !== "canonical",
    );
    if (extras.length === 0) {
      return {
        status: "pass",
        detail: "Title, description en canonical aanwezig",
      };
    }
    return {
      status: "pass",
      detail: `Title, description en canonical aanwezig; ook ${extras.join(", ")}`,
    };
  }

  const extras = result.missing.filter(
    (f) => f !== "description" && f !== "canonical",
  );
  const missingLine =
    extras.length > 0
      ? ` (ook mist: ${extras.join(", ")})`
      : "";
  return {
    status: "warn",
    detail: `Title aanwezig maar ${critical.join(", ")} ontbreekt${missingLine}`,
  };
}

export function metaTagsEvidence(result: MetaTagResult): MetaTagsEvidence {
  return {
    kind: "meta-tags",
    present: result.present,
    missing: result.missing,
    values: result.values as Record<string, string>,
  };
}

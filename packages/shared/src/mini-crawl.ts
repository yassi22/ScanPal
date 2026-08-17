import { z } from "zod";
import { extractInternalLinks } from "./routes";

/**
 * Feature 38 — mini-crawl check: image-alt audit + orphan-page detectie.
 * Pure logica (geen netwerk); de worker-wrapper in
 * `apps/worker/src/checks/http/mini-crawl.ts` haalt homepage-HTML + sitemap op
 * en roept deze helpers aan. De check-id `mini-crawl` bestaat al in de catalog
 * (category seo).
 *
 * Orphan-detectie is een heuristiek: een sitemap-route die vanaf de homepage
 * niet intern gelinkt is, is een potentiële orphan (de mini-crawler fetcht
 * alleen de homepage; dieper geneste links blijven onzichtbaar).
 */

/** Eén `<img>`-tag met src + alt (null = geen alt-attribuut). */
export type ImageInfo = {
  src: string;
  alt: string | null;
};

export const imageInfoSchema = z.object({
  src: z.string(),
  alt: z.string().nullable(),
});

/**
 * Extraheert `<img>`-tags uit HTML. `alt: null` = geen alt-attribuut;
 * `alt: ""` = leeg alt-attribuut (decoratief, toegestaan maar leeg).
 */
export function extractImages(html: string): ImageInfo[] {
  const images: ImageInfo[] = [];
  const re = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    const src = attrValue(tag, "src") ?? "";
    const altRaw = attrValue(tag, "alt");
    images.push({ src, alt: altRaw });
  }
  return images;
}

function attrValue(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? "";
}

export type ImageAltAudit = {
  total: number;
  /** Images zonder alt-attribuut (null). Lege alt ("") telt niet als missing. */
  missing: number;
  /** Eerste N src's zonder alt (voor evidence). */
  samples: string[];
};

export const imageAltAuditSchema = z.object({
  total: z.number().int(),
  missing: z.number().int(),
  samples: z.array(z.string()),
});

/** Telt `<img>` zonder alt-attribuut; lege alt ("") is expliciet decoratief. */
export function auditImageAlts(html: string): ImageAltAudit {
  const images = extractImages(html);
  const missingSrcs = images
    .filter((img) => img.alt === null && img.src)
    .map((img) => img.src);
  return {
    total: images.length,
    missing: missingSrcs.length,
    samples: missingSrcs.slice(0, 10),
  };
}

export type OrphanResult = {
  sitemap_count: number;
  orphan_count: number;
  /** Eerste N orphan-route-URL's (voor evidence). */
  samples: string[];
};

export const orphanResultSchema = z.object({
  sitemap_count: z.number().int(),
  orphan_count: z.number().int(),
  samples: z.array(z.string()),
});

/**
 * Orphan-detectie: sitemap-routes die niet voorkomen in de set intern gelinkte
 * routes vanaf de homepage. `linkedRoutes` zijn genormaliseerde URL's
 * (uit `extractInternalLinks`). De homepage zelf telt niet als orphan.
 */
export function detectOrphanPages(
  sitemapRoutes: string[],
  linkedRoutes: string[],
): OrphanResult {
  const linked = new Set(linkedRoutes);
  const orphans = sitemapRoutes.filter((url) => !linked.has(url));
  return {
    sitemap_count: sitemapRoutes.length,
    orphan_count: orphans.length,
    samples: orphans.slice(0, 10),
  };
}

/**
 * Convenience: bouwt de orphan-set uit homepage-HTML + sitemap-URL's.
 * Hergebruikt `extractInternalLinks` voor de homepage-links.
 */
export function orphanPagesFromHomeHtml(
  homeHtml: string,
  baseUrl: string,
  sitemapRoutes: string[],
): OrphanResult {
  const linked = extractInternalLinks(homeHtml, baseUrl);
  return detectOrphanPages(sitemapRoutes, linked);
}

export const miniCrawlEvidenceSchema = z.object({
  kind: z.literal("mini-crawl"),
  image_audit: imageAltAuditSchema,
  orphan_pages: orphanResultSchema,
});
export type MiniCrawlEvidence = z.infer<typeof miniCrawlEvidenceSchema>;

export function miniCrawlEvidence(
  imageAudit: ImageAltAudit,
  orphans: OrphanResult,
): MiniCrawlEvidence {
  return {
    kind: "mini-crawl",
    image_audit: imageAudit,
    orphan_pages: orphans,
  };
}

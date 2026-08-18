import { z } from "zod";

/**
 * Feature 43 — AEO JS-rendered content check (category aeo, homepage-only).
 * Vergelijkt de server-gerenderde HTML (zonder JavaScript) met de
 * JS-gerenderde DOM: als de kerncontent pas ná JavaScript-uitvoering bestaat,
 * is de pagina slecht (of niet) parseerbaar door LLM/AI-crawlers die geen
 * JavaScript uitvoeren (SPA-cloaking-risico).
 *
 * De worker-wrapper in `apps/worker/src/checks/browser/aeo-render.ts` haalt de
 * twee probes via de injectable BrowserRunner (`captureRenderCompare`) en voert
 * de ruwe data aan deze helpers.
 *
 * Besluiten:
 * - Server-probe wordt uit de ruwe HTML gehaald (regex-gebaseerd: scripts/
 *   styles eruit, tags eraf, entity-decoding). Een proxy voor zichtbare tekst.
 * - Gerenderde probe komt uit de live DOM (innerText, heading-count, title,
 *   meta-description, links).
 * - Fail: server-tekst is nagenoeg leeg (<100 tekens) terwijl de DOM ≥500
 *   tekens heeft (SPA-shell), óf gerenderde tekst ≥10× de server-tekst.
 * - Warn: gerenderde tekst ≥3× de server-tekst, headings die alleen in de DOM
 *   bestaan, of title/meta-description die alleen na JS bestaan.
 */

export type RenderProbe = {
  /** Lengte van de zichtbare tekst (tekens, witruimte-gecollapsed). */
  text_length: number;
  /** Aantal h1–h6-headings. */
  heading_count: number;
  /** <title>-waarde, of null als die ontbreekt. */
  title: string | null;
  /** meta[name="description"]-content, of null als die ontbreekt. */
  meta_description: string | null;
  /** Aantal anchors met href. */
  link_count: number;
};

export type RenderCompareCapture = {
  server: RenderProbe;
  rendered: RenderProbe;
};

export const renderProbeSchema = z.object({
  text_length: z.number().int().min(0),
  heading_count: z.number().int().min(0),
  title: z.string().nullable(),
  meta_description: z.string().nullable(),
  link_count: z.number().int().min(0),
});

export const renderCompareCaptureSchema = z.object({
  server: renderProbeSchema,
  rendered: renderProbeSchema,
});

export type RenderCompareEvidence = {
  kind: "aeo-render";
  server: RenderProbe;
  rendered: RenderProbe;
  /** rendered.text_length / max(server.text_length, 1), 1 decimaal. */
  text_ratio: number;
  /** rendered.text_length - server.text_length. */
  content_delta: number;
  issues: string[];
};

export const renderCompareEvidenceSchema = z.object({
  kind: z.literal("aeo-render"),
  server: renderProbeSchema,
  rendered: renderProbeSchema,
  text_ratio: z.number(),
  content_delta: z.number().int(),
  issues: z.array(z.string()),
});

/** Drempels voor de LLM-parsability-heuristiek (zie module-header). */
export const RENDER_EMPTY_SERVER_TEXT = 100;
export const RENDER_SUBSTANTIAL_DOM_TEXT = 500;
export const RENDER_FAIL_RATIO = 10;
export const RENDER_WARN_RATIO = 3;

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function extractMetaDescription(html: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\bname\s*=\s*["']description["']/i.test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (content) {
      const value = decodeBasicEntities(content[1].trim());
      if (value.length > 0) return value;
    }
  }
  return null;
}

/** Server-probe uit ruwe server-HTML (zonder JavaScript). */
export function extractServerProbe(html: string): RenderProbe {
  if (typeof html !== "string" || html.length === 0) {
    return { text_length: 0, heading_count: 0, title: null, meta_description: null, link_count: 0 };
  }
  const withoutHead = html.replace(/<head[\s\S]*?<\/head>/gi, " ");
  const withoutScripts = withoutHead.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = withoutStyles
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const headings = (html.match(/<h[1-6][\s>]/gi) ?? []).length;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeBasicEntities(titleMatch[1].trim()) : "";
  const links = (html.match(/<a\b[^>]*\bhref=/gi) ?? []).length;
  return {
    text_length: text.length,
    heading_count: headings,
    title: title.length > 0 ? title : null,
    meta_description: extractMetaDescription(html),
    link_count: links,
  };
}

/** Parseren van een ruwe probe (runner-output, schema-mock-defensie). */
export function parseRenderProbe(raw: unknown): RenderProbe | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    text_length?: unknown;
    heading_count?: unknown;
    title?: unknown;
    meta_description?: unknown;
    link_count?: unknown;
  };
  if (typeof row.text_length !== "number" || !Number.isFinite(row.text_length)) return null;
  if (typeof row.heading_count !== "number") return null;
  if (typeof row.link_count !== "number") return null;
  const title =
    typeof row.title === "string" && row.title.trim().length > 0 ? row.title.trim() : null;
  const metaDescription =
    typeof row.meta_description === "string" && row.meta_description.trim().length > 0
      ? row.meta_description.trim()
      : null;
  return {
    text_length: Math.max(0, Math.round(row.text_length)),
    heading_count: Math.max(0, Math.round(row.heading_count)),
    title,
    meta_description: metaDescription,
    link_count: Math.max(0, Math.round(row.link_count)),
  };
}

/** Parseren van een volledige render-vergelijking. */
export function parseRenderCompare(raw: unknown): RenderCompareCapture | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { server?: unknown; rendered?: unknown };
  const server = parseRenderProbe(row.server);
  const rendered = parseRenderProbe(row.rendered);
  if (!server || !rendered) return null;
  return { server, rendered };
}

export function textRatio(capture: RenderCompareCapture): number {
  const ratio = capture.rendered.text_length / Math.max(capture.server.text_length, 1);
  return Math.round(ratio * 10) / 10;
}

export function renderCompareEvidence(capture: RenderCompareCapture): RenderCompareEvidence {
  const issues: string[] = [];
  const serverLen = capture.server.text_length;
  const renderedLen = capture.rendered.text_length;
  const ratio = textRatio(capture);
  if (serverLen < RENDER_EMPTY_SERVER_TEXT && renderedLen >= RENDER_SUBSTANTIAL_DOM_TEXT) {
    issues.push(
      `Server-HTML bevat nagenoeg geen tekst (${serverLen} tekens) terwijl de gerenderde DOM ${renderedLen} tekens bevat — content lijkt volledig afhankelijk van JavaScript`,
    );
  } else if (serverLen > 0 && ratio >= RENDER_FAIL_RATIO) {
    issues.push(
      `Gerenderde tekst is ${ratio}× de server-HTML-tekst — kerncontent is zonder JavaScript niet zichtbaar`,
    );
  } else if (ratio >= RENDER_WARN_RATIO) {
    issues.push(
      `Gerenderde tekst is ${ratio}× de server-HTML-tekst — grote JS-afhankelijkheid`,
    );
  }
  if (capture.server.heading_count === 0 && capture.rendered.heading_count > 0) {
    issues.push("Headings worden alleen via JavaScript toegevoegd");
  }
  if (capture.server.title === null && capture.rendered.title !== null) {
    issues.push("Titel wordt alleen via JavaScript toegevoegd");
  }
  if (capture.server.meta_description === null && capture.rendered.meta_description !== null) {
    issues.push("Meta-description wordt alleen via JavaScript toegevoegd");
  }
  return {
    kind: "aeo-render",
    server: capture.server,
    rendered: capture.rendered,
    text_ratio: ratio,
    content_delta: renderedLen - serverLen,
    issues,
  };
}

/**
 * Overall-status: fail bij SPA-shell of ≥10×-tekst-ratio, warn bij ≥3×-ratio
 * of JS-only-headings/title/meta, anders pass.
 */
export function renderOverallStatus(capture: RenderCompareCapture): "pass" | "warn" | "fail" {
  const serverLen = capture.server.text_length;
  const renderedLen = capture.rendered.text_length;
  const ratio = textRatio(capture);
  if (serverLen < RENDER_EMPTY_SERVER_TEXT && renderedLen >= RENDER_SUBSTANTIAL_DOM_TEXT) {
    return "fail";
  }
  if (serverLen > 0 && ratio >= RENDER_FAIL_RATIO) return "fail";
  if (ratio >= RENDER_WARN_RATIO) return "warn";
  if (capture.server.heading_count === 0 && capture.rendered.heading_count > 0) return "warn";
  if (capture.server.title === null && capture.rendered.title !== null) return "warn";
  if (capture.server.meta_description === null && capture.rendered.meta_description !== null) {
    return "warn";
  }
  return "pass";
}

import { z } from "zod";
import {
  bundleKeyTypeSchema,
  bundleProviderSchema,
  extractBundleSecrets,
  type ExtractedBundleSecret,
} from "./bundle-secrets";
import { findingSeveritySchema, severityRank, type FindingSeverity } from "./severity";

/**
 * Feature 33 — secrets-in-HTML: scant het HTML-document zelf (inline `<script>`
 * zonder src, HTML-commentaren en de overgebleven ruwe HTML met attributen/
 * meta-tags) op gelekte API-keys/tokens. Hergebruikt de provider-specifieke
 * regex-set + entropie-calibratie uit `bundle-secrets.ts` (plan 53) zodat beide
 * checks dezelfde false-positive-banding hanteren. Pure logica (geen fetch);
 * de worker-wrapper in `apps/worker/src/checks/http/secrets-in-html.ts` haalt
 * de HTML op en roept deze helpers aan.
 *
 * Verschil met secrets-in-bundles: bundles downloadt externe `.js`-bestanden +
 * sourcemaps; secrets-in-html kijkt naar wat de server direct in het
 * HTML-document inline zet. Beide zijn nodig — een key in een inline script
 * lekt bij elke pageview zonder extra request.
 */

export const SECRETS_IN_HTML_LIMITS = {
  /** Max aantal matches per scan (afkappen, evidence blijft klein). */
  maxMatches: 50,
} as const;

/** Waar in het HTML-document het geheim is aangetroffen. */
export const htmlSecretLocationSchema = z.enum([
  "inline-script",
  "html-comment",
  "raw-html",
]);
export type HtmlSecretLocation = z.infer<typeof htmlSecretLocationSchema>;

export const htmlSecretLocationLabels: Record<HtmlSecretLocation, string> = {
  "inline-script": "inline <script>",
  "html-comment": "HTML-commentaar",
  "raw-html": "ruwe HTML (attribuut/meta)",
};

/** Finding-detail per match (feature 33 contract). */
export const htmlSecretMatchSchema = z.object({
  key_type: bundleKeyTypeSchema,
  provider: bundleProviderSchema,
  location: htmlSecretLocationSchema,
  /** Gemaskeerd (eerste 4 + laatste 4 tekens). */
  match_preview: z.string(),
  severity: findingSeveritySchema,
});
export type HtmlSecretMatch = z.infer<typeof htmlSecretMatchSchema>;

/** Gestructureerd evidence van de secrets-in-html-check. */
export const secretsInHtmlEvidenceSchema = z.object({
  kind: z.literal("secrets-in-html"),
  matches: z.array(htmlSecretMatchSchema),
  /** Info-notities (afgekapt, onleesbare blokken, …). */
  notes: z.array(z.string()).default([]),
});
export type SecretsInHtmlEvidence = z.infer<typeof secretsInHtmlEvidenceSchema>;

export type HtmlSecretScanResult = {
  matches: HtmlSecretMatch[];
  notes: string[];
};

/**
 * `<script>`-tag zonder `src` — alleen inline scripts hebben bruikbare content.
 * `(?![^>]*\bsrc\s*=)` slaat tags met een src-attribuut over.
 */
const INLINE_SCRIPT_RE = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
/** Alle `<script>`-tags (ook met src) — om uit de ruwe HTML te strippen. */
const ALL_SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const COMMENT_RE = /<!--([\s\S]*?)-->/g;

function collectMatches(
  text: string,
  location: HtmlSecretLocation,
  seen: Set<string>,
  matches: HtmlSecretMatch[],
): void {
  if (!text) return;
  const extracted: ExtractedBundleSecret[] = extractBundleSecrets(text);
  for (const secret of extracted) {
    if (seen.has(secret.raw)) continue;
    seen.add(secret.raw);
    matches.push({
      key_type: secret.key_type,
      provider: secret.provider,
      location,
      match_preview: secret.preview,
      severity: secret.severity,
    });
    if (matches.length >= SECRETS_IN_HTML_LIMITS.maxMatches) return;
  }
}

/**
 * Scant het HTML-document op inline geheimen. Volgorde: inline `<script>` →
 * HTML-commentaar → resterende ruwe HTML (scripts/styles/comments gestript,
 * zodat attributen/meta-tags/commentaar niet dubbel tellen). Dedupeert op ruwe
 * waarde over alle segmenten heen (eerste locatie wint).
 */
export function scanHtmlForSecrets(html: string): HtmlSecretScanResult {
  const matches: HtmlSecretMatch[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  // 1. Inline <script> contents (no src).
  INLINE_SCRIPT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_SCRIPT_RE.exec(html)) !== null) {
    collectMatches(m[1] ?? "", "inline-script", seen, matches);
    if (matches.length >= SECRETS_IN_HTML_LIMITS.maxMatches) {
      return { matches, notes };
    }
    if (m.index === INLINE_SCRIPT_RE.lastIndex) INLINE_SCRIPT_RE.lastIndex++;
  }

  // 2. HTML comments.
  COMMENT_RE.lastIndex = 0;
  while ((m = COMMENT_RE.exec(html)) !== null) {
    collectMatches(m[1] ?? "", "html-comment", seen, matches);
    if (matches.length >= SECRETS_IN_HTML_LIMITS.maxMatches) {
      return { matches, notes };
    }
    if (m.index === COMMENT_RE.lastIndex) COMMENT_RE.lastIndex++;
  }

  // 3. Remaining raw HTML (strip scripts/styles/comments to avoid double-count).
  const stripped = html
    .replace(ALL_SCRIPT_RE, " ")
    .replace(STYLE_RE, " ")
    .replace(COMMENT_RE, " ");
  collectMatches(stripped, "raw-html", seen, matches);

  return { matches, notes };
}

/** Hoogste severity over alle matches (info als er geen matches zijn). */
export function worstHtmlSecretSeverity(matches: HtmlSecretMatch[]): FindingSeverity {
  if (matches.length === 0) return "info";
  let worst: FindingSeverity = matches[0].severity;
  for (const match of matches) {
    if (severityRank[match.severity] > severityRank[worst]) worst = match.severity;
  }
  return worst;
}

export function secretsInHtmlEvidence(result: HtmlSecretScanResult): SecretsInHtmlEvidence {
  return {
    kind: "secrets-in-html",
    matches: result.matches,
    notes: result.notes,
  };
}

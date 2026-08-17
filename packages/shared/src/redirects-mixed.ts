import { z } from "zod";

/**
 * Plan 32 — redirects & mixed content. De worker levert de oorspronkelijke URL,
 * de final URL (na redirects) en de pagina-HTML; deze pure helpers detecteren
 * http→https-redirects, redirect-loops en mixed content (http:// resources op
 * een https-pagina). Eén check-id `redirects-mixed`.
 */

export const redirectsMixedEvidenceSchema = z.object({
  kind: z.literal("redirects-mixed"),
  final_url: z.string(),
  redirected: z.boolean(),
  https_upgraded: z.boolean(),
  redirect_chain: z.array(z.string()),
  mixed_content: z.array(
    z.object({
      tag: z.string(),
      attr: z.string(),
      url: z.string(),
    }),
  ),
});
export type RedirectsMixedEvidence = z.infer<typeof redirectsMixedEvidenceSchema>;

export type MixedContentItem = { tag: string; attr: string; url: string };

const MIXED_CONTENT_RE = [
  { tag: "script", attr: "src", re: /<script[^>]+\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi },
  { tag: "link", attr: "href", re: /<link[^>]+\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi },
  { tag: "img", attr: "src", re: /<img[^>]+\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi },
  { tag: "iframe", attr: "src", re: /<iframe[^>]+\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi },
  { tag: "source", attr: "src", re: /<source[^>]+\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi },
  { tag: "video", attr: "src", re: /<video[^>]+\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi },
  { tag: "audio", attr: "src", re: /<audio[^>]+\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi },
];

export function isHttps(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/**
 * Vindt http://-resources op een https-pagina (mixed content). Cross-origin
 * http-resources op een https-pagina worden door browsers geblokkeerd/gedown-
 * graded; dit is een security + SEO-issue.
 */
export function findMixedContent(html: string, pageUrl: string): MixedContentItem[] {
  if (!isHttps(pageUrl)) return [];
  const items: MixedContentItem[] = [];
  for (const { tag, attr, re } of MIXED_CONTENT_RE) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const url = match[1];
      if (/^http:\/\//i.test(url)) {
        items.push({ tag, attr, url: url.slice(0, 300) });
      }
    }
  }
  return items;
}

export type RedirectAnalysis = {
  redirected: boolean;
  httpsUpgraded: boolean;
  finalUrl: string;
};

export function analyzeRedirect(
  originalUrl: string,
  finalUrl: string,
): RedirectAnalysis {
  return {
    redirected: originalUrl !== finalUrl,
    httpsUpgraded: !isHttps(originalUrl) && isHttps(finalUrl),
    finalUrl,
  };
}

export function redirectsMixedEvidence(
  analysis: RedirectAnalysis,
  mixedContent: MixedContentItem[],
  redirectChain: string[] = [],
): RedirectsMixedEvidence {
  return {
    kind: "redirects-mixed",
    final_url: analysis.finalUrl,
    redirected: analysis.redirected,
    https_upgraded: analysis.httpsUpgraded,
    redirect_chain: redirectChain,
    mixed_content: mixedContent,
  };
}

export function evaluateRedirectsMixed(
  analysis: RedirectAnalysis,
  mixedContent: MixedContentItem[],
): { status: "pass" | "warn" | "fail"; detail: string } {
  const issues: string[] = [];
  if (!isHttps(analysis.finalUrl)) {
    issues.push("final URL is niet HTTPS");
  }
  if (mixedContent.length > 0) {
    issues.push(`${mixedContent.length} mixed-content resource(s) (http:// op https-pagina)`);
  }
  if (issues.length === 0) {
    if (analysis.httpsUpgraded) {
      return { status: "pass", detail: "HTTP→HTTPS redirect actief, geen mixed content" };
    }
    return { status: "pass", detail: "Geen redirects of mixed content" };
  }
  if (mixedContent.length > 0) {
    return { status: "fail", detail: issues.join("; ") };
  }
  return { status: "warn", detail: issues.join("; ") };
}

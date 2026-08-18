import {
  BUNDLE_SCAN_LIMITS,
  bundleProviderLabels,
  extractBundleSecrets,
  extractScriptSrc,
  parseSourceMappingComment,
  severityRank,
  type BundleSecretEvidence,
  type BundleSecretMatch,
  type BundleSecretProvider,
  type ExtractedBundleSecret,
  type FindingSeverity,
  type InlineCheckLike,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";
import type { RateLimiter } from "../../rate-limit";

type DownloadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "rate-limited" | "too-large" | "error"; detail: string };

/**
 * Download een bundel/sourcemap met per-host Redis rate-limit (verplicht uit
 * AGENTS.md), 5 MB-grens (streaming) en een per-request timeout — port van de
 * tijdelijke webapp-runner (plan 53) naar de http-worker (plan 27).
 */
async function downloadText(
  url: string,
  rateLimit: RateLimiter,
): Promise<DownloadResult> {
  const host = new URL(url).hostname;
  const rate = await rateLimit(
    `bundle-scan:${host}`,
    BUNDLE_SCAN_LIMITS.downloadsPerHostPerMinute,
  );
  if (!rate.ok) return { ok: false, reason: "rate-limited", detail: "rate-limit" };

  try {
    // Via fetchPage: SSRF-guard (private targets geweigerd, ook per redirect-
    // hop) + byte-cap van 5 MB in de body-stream.
    const res = await fetchPage(url, {
      timeoutMs: BUNDLE_SCAN_LIMITS.downloadTimeoutMs,
      maxBytes: BUNDLE_SCAN_LIMITS.maxBundleBytes,
    });
    if (!res.ok) {
      return { ok: false, reason: "error", detail: `HTTP ${res.status}` };
    }
    const text = await res.text();
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("exceeds")) {
      return { ok: false, reason: "too-large", detail: "> 5 MB" };
    }
    return { ok: false, reason: "error", detail: "download mislukt" };
  }
}

function decodeInlineMap(ref: { payload: string; base64: boolean }): string | null {
  try {
    return ref.base64
      ? Buffer.from(ref.payload, "base64").toString("utf8")
      : decodeURIComponent(ref.payload);
  } catch {
    return null;
  }
}

function sourcesContentFromMap(mapText: string): string[] {
  try {
    const map = JSON.parse(mapText) as { sourcesContent?: unknown };
    if (!Array.isArray(map.sourcesContent)) return [];
    return map.sourcesContent.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function worstSeverity(severities: FindingSeverity[]): FindingSeverity {
  if (severities.length === 0) return "info";
  return severities.reduce((worst, current) =>
    severityRank[current] > severityRank[worst] ? current : worst,
  );
}

export function createSecretsInBundlesCheck(
  rateLimit: RateLimiter,
): CheckImplementation {
  const download = (url: string) => downloadText(url, rateLimit);

  return {
    id: "secrets-in-bundles",
    category: "http",
    async run(ctx): Promise<InlineCheckLike[]> {
      let html = "";
      try {
        const page = await fetchPage(ctx.url, { timeoutMs: 10_000 });
        const contentType = page.headers.get("content-type") ?? "";
        if (contentType.includes("text/html")) {
          html = await page.text();
        }
      } catch {
        html = "";
      }
      if (!html) {
        return [
          {
            id: "secrets-in-bundles",
            name: "Secrets in JS-bundles",
            status: "info",
            detail: "Geen HTML-pagina — JS-bundels niet controleerbaar",
          },
        ];
      }

      const matches: BundleSecretMatch[] = [];
      const notes: string[] = [];
      const seen = new Set<string>();

      const addMatches = (
        extracted: ExtractedBundleSecret[],
        file: string,
        sourcemap: boolean,
      ) => {
        for (const secret of extracted) {
          if (seen.has(secret.raw)) continue;
          seen.add(secret.raw);
          matches.push({
            key_type: secret.key_type,
            provider: secret.provider,
            file,
            sourcemap,
            match_preview: secret.preview,
            severity: secret.severity,
          });
          if (matches.length >= BUNDLE_SCAN_LIMITS.maxMatches) return;
        }
      };

      const scriptUrls = extractScriptSrc(html, ctx.url);
      const unique = [...new Set(scriptUrls)];
      const bundles = unique.slice(0, BUNDLE_SCAN_LIMITS.maxBundles);
      if (unique.length > BUNDLE_SCAN_LIMITS.maxBundles) {
        notes.push(
          `${unique.length - BUNDLE_SCAN_LIMITS.maxBundles} bundel(s) overgeslagen (max ${BUNDLE_SCAN_LIMITS.maxBundles}).`,
        );
      }

      for (const bundleUrl of bundles) {
        const dl = await download(bundleUrl);
        if (!dl.ok) {
          notes.push(`Bundel niet gescand (${dl.detail}): ${bundleUrl}`);
          continue;
        }

        addMatches(extractBundleSecrets(dl.text), bundleUrl, false);
        if (matches.length >= BUNDLE_SCAN_LIMITS.maxMatches) break;

        const mapRef = parseSourceMappingComment(dl.text);
        if (!mapRef) continue;

        let mapText: string | null = null;
        if (mapRef.kind === "inline") {
          mapText = decodeInlineMap(mapRef);
          if (mapText === null) {
            notes.push(`Inline sourcemap niet te decoderen: ${bundleUrl}`);
          }
        } else {
          let mapUrl: string;
          try {
            mapUrl = new URL(mapRef.url, bundleUrl).toString();
          } catch {
            continue;
          }
          const mapDownload = await download(mapUrl);
          if (!mapDownload.ok) {
            notes.push(
              mapDownload.reason === "error" && mapDownload.detail === "HTTP 404"
                ? `Sourcemap niet gevonden (404): ${mapUrl}`
                : `Sourcemap niet gescand (${mapDownload.detail}): ${mapUrl}`,
            );
            continue;
          }
          mapText = mapDownload.text;
        }

        if (mapText !== null) {
          for (const content of sourcesContentFromMap(mapText)) {
            addMatches(extractBundleSecrets(content), bundleUrl, true);
            if (matches.length >= BUNDLE_SCAN_LIMITS.maxMatches) break;
          }
        }
      }

      const providerCounts = new Map<BundleSecretProvider, number>();
      for (const match of matches) {
        providerCounts.set(
          match.provider,
          (providerCounts.get(match.provider) ?? 0) + 1,
        );
      }
      const providerSummary =
        matches.length > 0
          ? ` (${[...providerCounts.entries()]
              .map(([provider, count]) => `${count}× ${bundleProviderLabels[provider]}`)
              .join(", ")})`
          : "";

      const scannedCount = bundles.length;
      const severity = worstSeverity(matches.map((m) => m.severity));
      const status =
        matches.length === 0
          ? (notes.length > 0 ? "info" : "pass")
          : severityRank[severity] >= severityRank.high
            ? "fail"
            : "warn";

      const evidence: BundleSecretEvidence = { kind: "bundle-secrets", matches, notes };
      const detail =
        matches.length > 0
          ? `${matches.length} geheim(en) gevonden in ${scannedCount} gescande bundel(s)${providerSummary}.`
          : notes.length > 0
            ? `Geen geheimen gevonden in ${scannedCount} gescande bundel(s), maar er zijn aandachtspunten: ${notes.join(" ")}`
            : `Geen geheimen gevonden in ${scannedCount} gescande bundel(s).`;

      return [
        {
          id: "secrets-in-bundles",
          name: "Secrets in JS-bundles",
          status,
          detail,
          severity,
          evidence:
            matches.length > 0 || notes.length > 0 ? evidence : null,
        },
      ];
    },
  };
}
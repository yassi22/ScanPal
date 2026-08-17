import {
  bundleProviderLabels,
  scanHtmlForSecrets,
  secretsInHtmlEvidence,
  severityRank,
  worstHtmlSecretSeverity,
  type BundleSecretProvider,
  type FindingSeverity,
  type InlineCheckLike,
  type SecretsInHtmlEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Feature 33 — secrets-in-HTML check. Eén fetch per route; pure logica in
 * `packages/shared/src/secrets-in-html.ts` (hergebruikt de provider-regex-set
 * uit bundle-secrets). Status: fail bij high/critical severity, warn bij
 * medium/low, pass als er geen matches zijn.
 */
export const secretsInHtmlCheck: CheckImplementation = {
  id: "secrets-in-html",
  category: "http",
  async run(ctx) {
    let html = "";
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        html = await response.text();
      }
    } catch {
      html = "";
    }
    if (!html) {
      return [
        {
          id: "secrets-in-html",
          name: "Secrets in HTML",
          status: "info",
          detail: "Geen HTML-pagina — inline geheimen niet controleerbaar",
        },
      ];
    }

    const result = scanHtmlForSecrets(html);
    const { matches, notes } = result;

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

    const severity: FindingSeverity = worstHtmlSecretSeverity(matches);
    const status: InlineCheckLike["status"] =
      matches.length === 0
        ? notes.length > 0
          ? "info"
          : "pass"
        : severityRank[severity] >= severityRank.high
          ? "fail"
          : "warn";

    const evidence: SecretsInHtmlEvidence = secretsInHtmlEvidence(result);
    const detail =
      matches.length > 0
        ? `${matches.length} geheim(en) gevonden in inline HTML${providerSummary}.`
        : notes.length > 0
          ? `Geen geheimen gevonden in inline HTML, maar er zijn aandachtspunten: ${notes.join(" ")}`
          : "Geen geheimen gevonden in inline HTML.";

    return [
      {
        id: "secrets-in-html",
        name: "Secrets in HTML",
        status,
        detail,
        severity,
        evidence: matches.length > 0 || notes.length > 0 ? evidence : null,
      },
    ];
  },
};

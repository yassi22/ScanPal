import {
  evaluateStructuredData,
  extractStructuredData,
  structuredDataEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Plan 39 — structured data (JSON-LD). Vindt application/ld+json-blokken in
 * de pagina-HTML, parset ze en valideert basis schema.org-vorm (@type
 * aanwezig, bekende types).
 */
export const structuredDataCheck: CheckImplementation = {
  id: "structured-data",
  category: "seo",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return [
          {
            id: "structured-data",
            name: "Structured data (JSON-LD)",
            status: "info",
            detail: `Geen HTML-pagina (${contentType || "onbekend"}) — structured data niet controleerbaar`,
          },
        ];
      }
      const html = await response.text();
      const { blocks, types } = extractStructuredData(html);
      const { status, detail } = evaluateStructuredData(blocks, types);
      return [
        {
          id: "structured-data",
          name: "Structured data (JSON-LD)",
          status,
          detail,
          evidence: structuredDataEvidence(blocks, types),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "structured-data",
          name: "Structured data (JSON-LD)",
          status: "fail",
          detail: `Structured data niet controleerbaar: ${message}`,
        },
      ];
    }
  },
};

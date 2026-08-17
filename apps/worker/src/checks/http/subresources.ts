import {
  evaluateSubresources,
  extractSubresources,
  subresourcesEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Plan 34 — subresource-integriteit (SRI). Vindt externe script/link-
 * stylesheet-resources in de HTML en checkt het `integrity`-attribuut.
 */
export const subresourcesCheck: CheckImplementation = {
  id: "subresources",
  category: "http",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return [
          {
            id: "subresources",
            name: "Subresource-integriteit",
            status: "info",
            detail: `Geen HTML-pagina (${contentType || "onbekend"}) — subresources niet controleerbaar`,
          },
        ];
      }
      const html = await response.text();
      const resources = extractSubresources(html, response.url || ctx.url);
      const { status, detail } = evaluateSubresources(resources);
      return [
        {
          id: "subresources",
          name: "Subresource-integriteit",
          status,
          detail,
          evidence: subresourcesEvidence(resources),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "subresources",
          name: "Subresource-integriteit",
          status: "fail",
          detail: `Subresources niet controleerbaar: ${message}`,
        },
      ];
    }
  },
};

import {
  evaluateMetaTags,
  extractMetaTags,
  metaTagsEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Plan 35 — meta/OG/canonical/hreflang check op de pagina-HTML. Eén fetch per
 * route, pure logica in `packages/shared/src/meta-tags.ts`. Status: fail als
 * title ontbreekt, warn als description/canonical ontbreekt, pass anders.
 */
export const metaTagsCheck: CheckImplementation = {
  id: "meta-tags",
  category: "seo",
  async run(ctx) {
    try {
      const response = await (ctx.fetchPage ?? fetchPage)(ctx.url, { timeoutMs: 10000 });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return [
          {
            id: "meta-tags",
            name: "Meta & OG-tags",
            status: "warn",
            detail: `Geen HTML-pagina (${contentType || "onbekend content-type"}) — meta-tags niet controleerbaar`,
          },
        ];
      }
      const html = await response.text();
      const result = extractMetaTags(html);
      const { status, detail } = evaluateMetaTags(result);
      return [
        {
          id: "meta-tags",
          name: "Meta & OG-tags",
          status,
          detail,
          evidence: metaTagsEvidence(result),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "meta-tags",
          name: "Meta & OG-tags",
          status: "fail",
          detail: `Meta-tags niet controleerbaar: ${message}`,
        },
      ];
    }
  },
};
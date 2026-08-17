import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

export const metaTagsCheck: CheckImplementation = {
  id: "meta-tags",
  category: "seo",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
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
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
      return [
        {
          id: "meta-tags",
          name: "Meta & OG-tags",
          status: title ? "pass" : "warn",
          detail: title
            ? `Pagina heeft een <title> ("${title.slice(0, 80)}")`
            : "Pagina is HTML maar heeft geen <title> tag",
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
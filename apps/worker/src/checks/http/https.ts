import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

export const httpsCheck: CheckImplementation = {
  id: "https",
  category: "http",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      const urlIsHttps = ctx.url.startsWith("https://");
      if (urlIsHttps) {
        return [
          {
            id: "https",
            name: "HTTPS",
            status: "pass",
            detail: "Verbinding verloopt over HTTPS",
          },
        ];
      }
      const finalUrl = response.url ?? ctx.url;
      if (finalUrl.startsWith("https://")) {
        return [
          {
            id: "https",
            name: "HTTPS",
            status: "pass",
            detail: "HTTP redirect naar HTTPS gevonden",
          },
        ];
      }
      return [
        {
          id: "https",
          name: "HTTPS",
          status: "fail",
          detail: "Site is niet bereikbaar over HTTPS",
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "https",
          name: "HTTPS",
          status: "fail",
          detail: `Site is niet bereikbaar over HTTPS: ${message}`,
        },
      ];
    }
  },
};
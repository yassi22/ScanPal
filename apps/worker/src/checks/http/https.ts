import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

export const httpsCheck: CheckImplementation = {
  id: "https",
  category: "http",
  async run(ctx) {
    let parsed: URL;
    try {
      parsed = new URL(ctx.url);
    } catch {
      return [
        {
          id: "https",
          name: "HTTPS",
          status: "fail",
          detail: `Ongeldige URL (${ctx.url})`,
        },
      ];
    }
    if (parsed.protocol !== "https:") {
      return [
        {
          id: "https",
          name: "HTTPS",
          status: "info",
          detail: "Site is HTTP — HTTPS niet van toepassing",
        },
      ];
    }

    // HTTPS afdwingen: fetch de rauwe http://-origin en kijk of die naar
    // https:// redirect. De canonieke ctx.url is altijd al https:// — die
    // alleen controleren zou een false "pass" geven voor sites die HTTPS
    // niet afdwingen.
    const httpUrl = `http://${parsed.host}${parsed.pathname}${parsed.search}`;
    try {
      const response = await fetchPage(httpUrl, { timeoutMs: 10000 });
      const finalUrl = response.url ?? httpUrl;
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
          detail: "Site dwingt HTTPS niet af: http:// leidt niet naar https://",
        },
      ];
    } catch {
      // Geen http://-listener (connection refused e.d.) → controleren of de
      // site wél over https bereikbaar is; dan is HTTPS feitelijk afgedwongen.
      try {
        const httpsRes = await fetchPage(ctx.url, { timeoutMs: 10000 });
        if (httpsRes.ok) {
          return [
            {
              id: "https",
              name: "HTTPS",
              status: "pass",
              detail: "HTTPS-only: geen http-listener, site alleen over HTTPS bereikbaar",
            },
          ];
        }
        return [
          {
            id: "https",
            name: "HTTPS",
            status: "fail",
            detail: `Site onbereikbaar over HTTP (${httpsRes.status})`,
          },
        ];
      } catch (err) {
        const message = err instanceof Error ? err.message : "Onbekende fout";
        return [
          {
            id: "https",
            name: "HTTPS",
            status: "fail",
            detail: `Site is niet bereikbaar: ${message}`,
          },
        ];
      }
    }
  },
};

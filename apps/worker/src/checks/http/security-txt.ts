import {
  analyzeNotFoundPage,
  evaluateSecurityTxt,
  parseSecurityTxt,
  securityTxtEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

/**
 * Plan 37 — security.txt (RFC 9116), favicon, 404-page kwaliteit. Drie extra
 * fetches per site: /.well-known/security.txt, /favicon.ico, en een random
 * onbekende pagina om de 404-respons te meten. Eén check-id `security-txt`.
 */
export const securityTxtCheck: CheckImplementation = {
  id: "security-txt",
  category: "seo",
  async run(ctx) {
    const origin = originOf(ctx.url);
    try {
      const ok = await ctx.rateLimit(`security-txt:${origin}`, 30, 60);
      if (!ok) {
        return [
          {
            id: "security-txt",
            name: "security.txt, favicon, 404",
            status: "warn",
            detail: "Rate-limit bereikt — security.txt/favicon/404 niet gecontroleerd",
          },
        ];
      }

      const [secResponse, favResponse, nfResponse] = await Promise.allSettled([
        fetchPage(`${origin}/.well-known/security.txt`, { timeoutMs: 8000 }),
        fetchPage(`${origin}/favicon.ico`, { timeoutMs: 8000 }),
        fetchPage(`${origin}/scanpal-404-probe-${Date.now()}`, { timeoutMs: 8000 }),
      ]);

      const secText = secResponse.status === "fulfilled" ? await secResponse.value.text() : null;
      const securityTxt = parseSecurityTxt(secText);

      const favicon = favResponse.status === "fulfilled"
        ? { present: favResponse.value.ok, status: favResponse.value.status }
        : { present: false, status: 0 };

      let notFoundPage;
      if (nfResponse.status === "fulfilled") {
        const html = await nfResponse.value.text();
        notFoundPage = analyzeNotFoundPage(html, nfResponse.value.status);
      } else {
        notFoundPage = {
          status: 0,
          is404: false,
          hasH1: false,
          hasSearch: false,
          hasHomeLink: false,
          looksCustom: false,
        };
      }

      const { status, detail } = evaluateSecurityTxt(securityTxt, favicon, notFoundPage);
      return [
        {
          id: "security-txt",
          name: "security.txt, favicon, 404",
          status,
          detail,
          evidence: securityTxtEvidence(securityTxt, favicon, notFoundPage),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "security-txt",
          name: "security.txt, favicon, 404",
          status: "fail",
          detail: `security.txt/favicon/404 niet controleerbaar: ${message}`,
        },
      ];
    }
  },
};

import {
  detectStack,
  evaluateStackDetection,
  stackDetectionEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Plan 40 — stackdetectie op de homepage: headers + HTML worden gevoed aan de
 * pure `detectStack` helper in shared. Eén fetch, geen extra outbound calls.
 */
export const stackDetectionCheck: CheckImplementation = {
  id: "stack-detection",
  category: "seo",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      const contentType = response.headers.get("content-type") ?? "";
      const html = contentType.includes("text/html") ? await response.text() : "";
      const setCookie = response.headers.get("set-cookie") ?? "";
      const cookies = setCookie
        ? splitCookies(setCookie)
        : [];
      const matches = detectStack(response.headers, html, cookies);
      const { status, detail } = evaluateStackDetection(matches);
      return [
        {
          id: "stack-detection",
          name: "Stackdetectie (CMS/framework)",
          status,
          detail,
          evidence: stackDetectionEvidence(matches),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "stack-detection",
          name: "Stackdetectie (CMS/framework)",
          status: "warn",
          detail: `Stackdetectie niet uitvoerbaar: ${message}`,
        },
      ];
    }
  },
};

function splitCookies(setCookie: string): string[] {
  return setCookie
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((line) => line.split("=")[0].trim())
    .filter(Boolean);
}

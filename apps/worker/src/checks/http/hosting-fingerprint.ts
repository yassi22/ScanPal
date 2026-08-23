import {
  evaluateHostingFingerprint,
  fingerprintHosting,
  hostingFingerprintEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Plan 69 — hosting-fingerprint & platform-security. Hergebruikt de homepage-
 * fetch (één request, geen extra outbound calls) en voert de pure
 * `fingerprintHosting`-helper uit op de response-headers + scan-URL. Eén
 * site-level finding (route_url null in de scan-worker).
 */
export const hostingSecurityCheck: CheckImplementation = {
  id: "hosting-security",
  category: "http",
  async run(ctx) {
    try {
      const response = await (ctx.fetchPage ?? fetchPage)(ctx.url, {
        timeoutMs: 10000,
      });
      const fp = fingerprintHosting(response.headers, ctx.url);
      const { status, detail, severity } = evaluateHostingFingerprint(fp);
      return [
        {
          id: "hosting-security",
          name: "Hosting-fingerprint & platform-security",
          status,
          detail,
          severity,
          evidence: hostingFingerprintEvidence(fp),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "hosting-security",
          name: "Hosting-fingerprint & platform-security",
          status: "warn",
          detail: `Hosting-fingerprint niet uitvoerbaar: ${message}`,
        },
      ];
    }
  },
};

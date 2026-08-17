import {
  checkCatalog,
  type InlineCheckLike,
  type QueueName,
  type ScanCategory,
} from "@scanpal/shared";
import type { RateLimiter } from "../rate-limit";
import type { CheckContext } from "./types";
import { reachabilityCheck } from "./http/reachability";
import { httpsCheck } from "./http/https";
import { tlsCertCheck } from "./http/tls-cert";
import { domainWatchtowerCheck } from "./http/domain-watchtower";
import { SECURITY_HEADER_CHECK_IDS, securityHeadersCheck } from "./http/security-headers";
import { metaTagsCheck } from "./http/meta-tags";
import { COOKIE_CHECK_IDS, cookiesCheck } from "./http/cookies";
import { createSecretsInBundlesCheck } from "./http/secrets-in-bundles";
import { createActiveTestsCheck } from "./http/active-tests";
import { corsCheck } from "./http/cors";
import { aeoEngineMatrixCheck } from "./http/aeo-engine-matrix";
import { COMPLIANCE_CHECK_IDS, complianceCheck } from "./http/compliance";
import { stackDetectionCheck } from "./http/stack-detection";
import { redirectsMixedCheck } from "./http/redirects-mixed";
import { subresourcesCheck } from "./http/subresources";
import { structuredDataCheck } from "./http/structured-data";
import { securityTxtCheck } from "./http/security-txt";

/**
 * Geïmplementeerde check per queue (plan 27, besluit 8). `outputCheckIds`
 * zijn de catalog-ids die één implementatie kan produceren: de meeste
 * implementaties produceren exact hun eigen id; `active-tests` fanned uit
 * naar alle actieve-test-catalog-checks (plan 52) wanneer de scan-flag staat.
 */
export type ImplementedCheck = {
  id: string;
  category: ScanCategory;
  outputCheckIds: string[];
  run(ctx: CheckContext): Promise<InlineCheckLike[]>;
};

const activeTestCatalogIds = checkCatalog
  .filter((entry) => entry.active)
  .map((entry) => entry.id);

function toImplemented(
  impl: { id: string; category: ScanCategory; run(ctx: CheckContext): Promise<InlineCheckLike[]> },
  outputCheckIds?: string[],
): ImplementedCheck {
  return { id: impl.id, category: impl.category, outputCheckIds: outputCheckIds ?? [impl.id], run: impl.run };
}

export function buildRegistry(rateLimit: RateLimiter): Record<QueueName, ImplementedCheck[]> {
  return {
    http: [
      toImplemented(reachabilityCheck),
      toImplemented(httpsCheck),
      toImplemented(tlsCertCheck),
      toImplemented(domainWatchtowerCheck),
      toImplemented(securityHeadersCheck, [...SECURITY_HEADER_CHECK_IDS]),
      toImplemented(metaTagsCheck),
      toImplemented(cookiesCheck, [...COOKIE_CHECK_IDS]),
      toImplemented(corsCheck),
      toImplemented(createSecretsInBundlesCheck(rateLimit)),
      toImplemented(createActiveTestsCheck(rateLimit), activeTestCatalogIds),
      // Plan 55: AEO per-engine matrix draait in de http-worker (geen browser
      // nodig); catalog-categorie is aeo (progress wordt via http voortgeschoven).
      toImplemented(aeoEngineMatrixCheck),
      // Plan 61: compliance-pijler (passief, homepage-only). Eén implementatie
      // produceert de vijf compliance-check-ids; categorie-compliance.
      toImplemented(complianceCheck, [...COMPLIANCE_CHECK_IDS]),
      // Plan 40: stackdetectie op de homepage (CMS/framework/server/CDN).
      toImplemented(stackDetectionCheck),
      // Plan 32: redirects + mixed content (http:// op https-pagina).
      toImplemented(redirectsMixedCheck),
      // Plan 34: subresource-integriteit (SRI integrity-attrs).
      toImplemented(subresourcesCheck),
      // Plan 39: structured data (JSON-LD schema.org).
      toImplemented(structuredDataCheck),
      // Plan 37: security.txt (RFC 9116) + favicon + 404-page kwaliteit.
      toImplemented(securityTxtCheck),
    ],
    // Features 41–43 vullen de browser-worker; feature 27 levert alleen de
    // pipeline (geen aeo-checks geïmplementeerd).
    browser: [],
    // Features 46–49 vullen de github-worker.
    github: [],
  };
}

/**
 * Progress-skelet-totalen per categorie (plan 27, besluit 2): de dispatcher
 * telt de checks die de workers in deze run gaan produceren. Actieve-test-
 * checks tellen alleen mee als `activeTests` aan staat.
 */
export function skeletonTotals(
  registry: Record<QueueName, ImplementedCheck[]>,
  queues: QueueName[],
  activeTests: boolean,
): Partial<Record<ScanCategory, number>> {
  const totals: Partial<Record<ScanCategory, number>> = {};
  for (const queue of queues) {
    for (const impl of registry[queue]) {
      if (impl.id === "active-tests" && !activeTests) continue;
      const count = impl.outputCheckIds.length;
      totals[impl.category] = (totals[impl.category] ?? 0) + count;
    }
  }
  return totals;
}
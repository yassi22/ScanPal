import {
  checkCatalog,
  type InlineCheckLike,
  type QueueName,
  type ScanCategory,
} from "@scanpal/shared";
import type { RateLimiter } from "../rate-limit";
import type { CheckContext } from "./types";
import type { Redis } from "ioredis";
import type { Pool } from "pg";
import { reachabilityCheck } from "./http/reachability";
import { httpsCheck } from "./http/https";
import { tlsCertCheck } from "./http/tls-cert";
import { domainWatchtowerCheck } from "./http/domain-watchtower";
import { dnsEmailCheck } from "./http/dns-email";
import { SECURITY_HEADER_CHECK_IDS, securityHeadersCheck } from "./http/security-headers";
import { metaTagsCheck } from "./http/meta-tags";
import { COOKIE_CHECK_IDS, cookiesCheck } from "./http/cookies";
import { createSecretsInBundlesCheck } from "./http/secrets-in-bundles";
import { secretsInHtmlCheck } from "./http/secrets-in-html";
import { createActiveTestsCheck } from "./http/active-tests";
import { corsCheck } from "./http/cors";
import { aeoEngineMatrixCheck } from "./http/aeo-engine-matrix";
import { createCruxFieldDataCheck } from "./http/crux-field-data";
import { COMPLIANCE_CHECK_IDS, complianceCheck } from "./http/compliance";
import { stackDetectionCheck } from "./http/stack-detection";
import { redirectsMixedCheck } from "./http/redirects-mixed";
import { subresourcesCheck } from "./http/subresources";
import { structuredDataCheck } from "./http/structured-data";
import { securityTxtCheck } from "./http/security-txt";
import { robotsSitemapCheck } from "./http/robots-sitemap";
import { miniCrawlCheck } from "./http/mini-crawl";
import { repoHealthCheck } from "./github/repo-health";
import { semgrepCheck } from "./github/semgrep";
import { gitleaksCheck } from "./github/gitleaks";
import { osvScannerCheck } from "./github/osv-scanner";
import { createCoreWebVitalsCheck } from "./browser/core-web-vitals";
import { createAccessibilityCheck } from "./browser/accessibility";
import { createConsoleErrorsCheck } from "./browser/console-errors";
import { createMobileResponsiveCheck } from "./browser/mobile-responsive";
import { createBrowserStorageCheck } from "./browser/browser-storage";
import { createAeoRenderCheck } from "./browser/aeo-render";
import type { BrowserRunner } from "./browser/runner";

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

export function buildRegistry(
  rateLimit: RateLimiter,
  browserRunner: BrowserRunner,
  cruxDeps: { redis: Redis; db: Pool },
): Record<QueueName, ImplementedCheck[]> {
  return {
    http: [
      toImplemented(reachabilityCheck),
      toImplemented(httpsCheck),
      toImplemented(tlsCertCheck),
      toImplemented(domainWatchtowerCheck),
      // Plan 68: DNS & e-mail (SPF/DKIM/DMARC/MX) — passieve publieke-DNS-meting.
      toImplemented(dnsEmailCheck),
      toImplemented(securityHeadersCheck, [...SECURITY_HEADER_CHECK_IDS]),
      toImplemented(metaTagsCheck),
      toImplemented(cookiesCheck, [...COOKIE_CHECK_IDS]),
      toImplemented(corsCheck),
      toImplemented(createSecretsInBundlesCheck(rateLimit)),
      // Feature 33: secrets-in-HTML — inline scripts/comments/attributen.
      toImplemented(secretsInHtmlCheck),
      toImplemented(createActiveTestsCheck(rateLimit), activeTestCatalogIds),
      // Plan 55: AEO per-engine matrix draait in de http-worker (geen browser
      // nodig); catalog-categorie is aeo (progress wordt via http voortgeschoven).
      toImplemented(aeoEngineMatrixCheck),
      // Plan 62: CrUX field data — pure REST-call in de http-worker (categorie
      // aeo); schrijft scans.crux via scan-core; geen data → info-finding.
      toImplemented(createCruxFieldDataCheck(cruxDeps)),
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
      // Feature 36: robots.txt & sitemap geldigheid/kwaliteit.
      toImplemented(robotsSitemapCheck),
      // Feature 38: mini-crawl — image-alt audit + orphan-page detectie.
      toImplemented(miniCrawlCheck),
    ],
    // Features 41–45 vullen de browser-worker.
    browser: [
      // Feature 41: Core Web Vitals (LCP/CLS/INP) via Playwright.
      toImplemented(createCoreWebVitalsCheck(browserRunner)),
      // Feature 42: Accessibility (axe-core) via Playwright.
      toImplemented(createAccessibilityCheck(browserRunner)),
      // Feature 44: console-errors + network-failures via Playwright.
      toImplemented(createConsoleErrorsCheck(browserRunner)),
      // Feature 45: mobile/responsive basis-check via Playwright.
      toImplemented(createMobileResponsiveCheck(browserRunner)),
      // Plan 70: browser storage & session-tokens (passief, leest storage).
      toImplemented(createBrowserStorageCheck(browserRunner)),
      // Feature 43: AEO JS-rendered content (server-HTML vs gerenderde DOM).
      toImplemented(createAeoRenderCheck(browserRunner)),
    ],
    // Features 46–49 vullen de github-worker.
    github: [
      // Feature 49: repo-health (branch protection, LICENSE, CI, MFA-proxy, README)
      // via GitHub REST API. Site-level (route_url null in scan-worker).
      toImplemented(repoHealthCheck),
      // Feature 46: Semgrep SAST via Docker (read-only repo-mount).
      toImplemented(semgrepCheck),
      // Feature 47: Gitleaks secrets-scan via Docker.
      toImplemented(gitleaksCheck),
      // Feature 48: OSV-Scanner dependency-vulns via Docker.
      toImplemented(osvScannerCheck),
    ],
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
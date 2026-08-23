import { describe, it, expect } from "vitest";
import { buildRegistry, skeletonTotals } from "../registry";
import type { BrowserRunner } from "../browser/runner";

const rateLimit = {} as never;
const cruxDeps = { redis: {}, db: {} } as never;
const mockRunner: BrowserRunner = {
  captureVitals: () => Promise.resolve({ ok: false, error: "mock" }),
  runAxe: () => Promise.resolve({ ok: false, error: "mock" }),
  captureConsole: () => Promise.resolve({ ok: false, error: "mock" }),
  captureResponsive: () => Promise.resolve({ ok: false, error: "mock" }),
  captureRenderCompare: () => Promise.resolve({ ok: false, error: "mock" }),
  captureStorage: () => Promise.resolve({ ok: false, error: "mock" }),
  captureClientDeps: () => Promise.resolve({ ok: false, error: "mock" }),
};

describe("skeletonTotals (progress-skelet)", () => {
  it("telt de eerste http-checks zonder actieve tests", () => {
    const registry = buildRegistry(rateLimit, mockRunner, cruxDeps);
    const totals = skeletonTotals(registry, ["http", "browser"], false);
    // reachability + https + tls-cert + domain-watchtower + 8 security-header-checks
    // + 5 cookie-checks + secrets-in-bundles + secrets-in-html + cors = http,
    // meta-tags = seo; active-tests telt niet mee zonder flag.
    // aeo-engine-matrix (plan 55) draait in de http-worker met categorie aeo
    // → telt mee onder aeo. compliance (plan 61) produceert 5 passieve checks
    // onder categorie compliance. stack-detection (plan 40) is category seo →
    // telt mee onder seo. redirects-mixed + subresources (plan 32/34) zijn
    // category http. structured-data + security-txt (plan 39/37) zijn category seo.
    // Feature 36: robots-sitemap draait in de http-worker (seo) → seo 5->6.
    // Feature 41: core-web-vitals draait in de browser-worker (aeo) → aeo 1->2;
    // feature 42 voegt accessibility toe (aeo 2->3).
    // Feature 44 (console-errors) + 45 (mobile-responsive) → aeo 3->5;
    // feature 43 (aeo-scan render-vergelijking) → aeo 5->6.
    // Plan 62: crux-field-data draait in de http-worker (aeo) → aeo 6->7.
    // Plan 68: dns-email is een nieuwe http-check → http 22->23.
    // Plan 69: hosting-security is een nieuwe http-check → http 23->24.
    // Plan 70: browser-storage is een nieuwe aeo-check → aeo 7->8.
    // Plan 71: client-deps-cve is een nieuwe http-check → http 24->25.
    // Plan 71 v2: client-deps-runtime is een nieuwe aeo-check → aeo 8->9.
    expect(totals.http).toBe(25);
    expect(totals.seo).toBe(6);
    expect(totals.aeo).toBe(9);
    expect(totals.compliance).toBe(5);
    // Categorieën zonder queue-owner krijgen geen key (initialProgressDetails
    // default naar 0).
    expect(totals.github).toBeUndefined();
  });

  it("telt de actieve-test-checks mee met de flag aan", () => {
    const registry = buildRegistry(rateLimit, mockRunner, cruxDeps);
    const totals = skeletonTotals(registry, ["http", "browser"], true);
    // 11 actieve-test-catalog-checks + 25 passieve http-checks.
    expect(totals.http).toBe(36);
    expect(totals.compliance).toBe(5);
  });

  it("draagt github-checks alleen mee als de queue draait", () => {
    const registry = buildRegistry(rateLimit, mockRunner, cruxDeps);
    const totals = skeletonTotals(registry, ["http", "browser", "github"], false);
    // Feature 49: repo-health is de eerste github-implementatie (site-level);
    // feature 46 voegt Semgrep toe, 47 Gitleaks, 48 OSV-Scanner (github 2->4).
    expect(totals.github).toBe(4);
  });
});
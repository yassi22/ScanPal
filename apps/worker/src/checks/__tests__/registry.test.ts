import { describe, it, expect } from "vitest";
import { buildRegistry, skeletonTotals } from "../registry";

const rateLimit = {} as never;

describe("skeletonTotals (progress-skelet)", () => {
  it("telt de eerste http-checks zonder actieve tests", () => {
    const registry = buildRegistry(rateLimit);
    const totals = skeletonTotals(registry, ["http", "browser"], false);
    // reachability + https + tls-cert + domain-watchtower + 8 security-header-checks
    // + 5 cookie-checks + secrets-in-bundles + cors = http, meta-tags = seo;
    // active-tests telt niet mee zonder flag. aeo-engine-matrix (plan 55)
    // draait in de http-worker met categorie aeo → telt mee onder aeo.
    // compliance (plan 61) produceert 5 passieve checks onder categorie compliance.
    // stack-detection (plan 40) is category seo → telt mee onder seo.
    expect(totals.http).toBe(19);
    expect(totals.seo).toBe(2);
    expect(totals.aeo).toBe(1);
    expect(totals.compliance).toBe(5);
    // Categorieën zonder queue-owner krijgen geen key (initialProgressDetails
    // default naar 0).
    expect(totals.github).toBeUndefined();
  });

  it("telt de actieve-test-checks mee met de flag aan", () => {
    const registry = buildRegistry(rateLimit);
    const totals = skeletonTotals(registry, ["http", "browser"], true);
    // 11 actieve-test-catalog-checks + 19 passieve http-checks.
    expect(totals.http).toBe(30);
    expect(totals.compliance).toBe(5);
  });

  it("draagt github-checks alleen mee als de queue draait", () => {
    const registry = buildRegistry(rateLimit);
    const totals = skeletonTotals(registry, ["http", "browser", "github"], false);
    // Feature 27 levert nog geen github-implementaties → geen key.
    expect(totals.github).toBeUndefined();
  });
});
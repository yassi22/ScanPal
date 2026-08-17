import { describe, it, expect } from "vitest";
import {
  computeScanDiff,
  countAtOrAbove,
  diffHasChanges,
  findingFingerprint,
  isCleanScan,
  isSnoozed,
  scanDiffSchema,
  sha256hex,
  type Finding,
} from "../index";

const NOW = "2026-08-17T10:00:00.000Z";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "check:title",
    check_id: "https",
    category: "http",
    severity: "high",
    title: "HTTPS ontbreekt",
    description: "Geen TLS",
    remediation: "Regel een certificaat",
    evidence: null,
    active: false,
    status: "open",
    note: null,
    route_url: null,
    regressed: false,
    snooze_until: null,
    created_at: NOW,
    ...overrides,
  };
}

describe("sha256hex", () => {
  it("kent de standaard test-vectors", () => {
    expect(sha256hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministisch", () => {
    expect(sha256hex("security-header-csp|/|CSP ontbreekt")).toBe(
      sha256hex("security-header-csp|/|CSP ontbreekt"),
    );
  });
});

describe("findingFingerprint", () => {
  it("is stabiel voor dezelfde check+route+title (regardless van detail/evidence)", () => {
    const a = findingFingerprint(makeFinding({ description: "oude tekst" }));
    const b = findingFingerprint(makeFinding({ description: "nieuwe tekst" }));
    expect(a).toBe(b);
  });

  it("is stabiel bij severity/status-wijziging (warn→fail is dezelfde bevinding)", () => {
    const a = findingFingerprint(makeFinding({ severity: "medium", status: "open" }));
    const b = findingFingerprint(makeFinding({ severity: "high", status: "fixed" }));
    expect(a).toBe(b);
  });

  it("verschilt per route", () => {
    const root = findingFingerprint(
      makeFinding({ route_url: "https://example.com/" }),
    );
    const about = findingFingerprint(
      makeFinding({ route_url: "https://example.com/about" }),
    );
    expect(root).not.toBe(about);
  });

  it("verschilt per title (verschillende rules op dezelfde check)", () => {
    const a = findingFingerprint(makeFinding({ title: "CSP ontbreekt" }));
    const b = findingFingerprint(makeFinding({ title: "CSP is zwak" }));
    expect(a).not.toBe(b);
  });
});

describe("isCleanScan", () => {
  it("is schoon bij score ≥ 80", () => {
    expect(isCleanScan(85, [makeFinding({ severity: "high", status: "open" })])).toBe(
      true,
    );
  });

  it("is schoon zonder open critical/high findings", () => {
    expect(
      isCleanScan(null, [makeFinding({ severity: "medium", status: "open" })]),
    ).toBe(true);
    expect(
      isCleanScan(40, [
        makeFinding({ severity: "low", status: "open" }),
        makeFinding({ severity: "high", status: "fixed" }),
      ]),
    ).toBe(true);
  });

  it("is niet schoon bij open critical/high", () => {
    expect(
      isCleanScan(70, [makeFinding({ severity: "high", status: "open" })]),
    ).toBe(false);
    expect(
      isCleanScan(90, [
        makeFinding({ severity: "critical", status: "open", active: true }),
      ]),
    ).toBe(true);
  });
});

describe("isSnoozed", () => {
  const now = new Date(NOW);
  it("actief bij future-datetime en het next-scan-sentinel", () => {
    expect(
      isSnoozed(makeFinding({ snooze_until: "2026-08-24T10:00:00.000Z" }), now),
    ).toBe(true);
    expect(isSnoozed(makeFinding({ snooze_until: "next-scan" }), now)).toBe(true);
  });

  it("verlopen bij past-datetime of null", () => {
    expect(isSnoozed(makeFinding({ snooze_until: null }), now)).toBe(false);
    expect(
      isSnoozed(makeFinding({ snooze_until: "2026-08-10T10:00:00.000Z" }), now),
    ).toBe(false);
  });
});

describe("computeScanDiff", () => {
  const now = new Date(NOW);

  it("classificeert new / resolved / regressed / unchanged per severity", () => {
    const snapshot = [
      makeFinding({
        id: "h:opgelost",
        check_id: "https",
        title: "HTTPS ontbreekt",
        severity: "high",
      }),
      makeFinding({
        id: "h:teruggekeerd",
        check_id: "cookie-httponly",
        title: "Cookie mist HttpOnly",
        severity: "medium",
        status: "ignored",
        note: "bewuste keuze",
      }),
      makeFinding({
        id: "h:onveranderd",
        check_id: "meta-tags",
        title: "Meta-tags onvolledig",
        severity: "low",
      }),
    ];

    const current = [
      makeFinding({
        id: "h:nieuw",
        check_id: "cors",
        title: "CORS te ruim",
        severity: "critical",
      }),
      makeFinding({
        id: "h:teruggekeerd",
        check_id: "cookie-httponly",
        title: "Cookie mist HttpOnly",
        severity: "medium",
        status: "open",
      }),
      makeFinding({
        id: "h:onveranderd",
        check_id: "meta-tags",
        title: "Meta-tags onvolledig",
        severity: "low",
        status: "fixed",
      }),
    ];

    const diff = computeScanDiff(current, snapshot, now);

    expect(diff.new).toMatchObject({ critical: 1, high: 0, medium: 0, low: 0, info: 0 });
    expect(diff.resolved).toMatchObject({ high: 1 });
    expect(diff.regressed).toMatchObject({ medium: 1 });
    expect(diff.unchanged).toMatchObject({ low: 1 });
    expect(diff.new_finding_ids).toEqual(["h:nieuw"]);
    expect(diff.regressed_finding_ids).toEqual(["h:teruggekeerd"]);
    expect(diff.alert_new).toMatchObject({ critical: 1 });
    expect(diff.alert_regressed).toMatchObject({ medium: 1 });
    expect(scanDiffSchema.safeParse(diff).success).toBe(true);
  });

  it("excludeert actieve-test-findings (plan 52)", () => {
    const current = [makeFinding({ active: true, severity: "critical" })];
    const diff = computeScanDiff(current, null, now);
    expect(diff.new).toMatchObject({ critical: 0 });
    expect(diffHasChanges(diff)).toBe(false);
  });

  it("excludeert gesnoozde findings uit alert-tellingen maar niet uit de view-tellingen", () => {
    const current = [
      makeFinding({
        id: "h:nieuw",
        check_id: "cors",
        title: "CORS te ruim",
        severity: "critical",
        snooze_until: "next-scan",
      }),
    ];
    const diff = computeScanDiff(current, null, now);
    expect(diff.new).toMatchObject({ critical: 1 });
    expect(diff.new_finding_ids).toEqual(["h:nieuw"]);
    expect(diff.alert_new).toMatchObject({ critical: 0 });
  });

  it("zonder snapshot is alles nieuw", () => {
    const diff = computeScanDiff([makeFinding({ id: "a:1" })], null, now);
    expect(diff.new.high).toBe(1);
    expect(diff.resolved.high).toBe(0);
    expect(diffHasChanges(diff)).toBe(true);
  });

  it("levert geen veranderingen op voor identieke scans (unchanged)", () => {
    const items = [makeFinding({ id: "a:1" })];
    const diff = computeScanDiff(items, items, now);
    expect(diff.unchanged.high).toBe(1);
    expect(diff.new.high).toBe(0);
    expect(diff.resolved.high).toBe(0);
    expect(diff.regressed.high).toBe(0);
    expect(diffHasChanges(diff)).toBe(false);
  });
});

describe("countAtOrAbove", () => {
  it("telt alleen severities op/onder de drempel", () => {
    const counts = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
      info: 5,
    };
    expect(countAtOrAbove(counts, "medium")).toBe(6);
    expect(countAtOrAbove(counts, "critical")).toBe(1);
    expect(countAtOrAbove(counts, "info")).toBe(15);
  });
});
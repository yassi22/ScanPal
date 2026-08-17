import { describe, it, expect } from "vitest";
import { findingsPayloadSchema } from "@scanpal/shared";
import { buildFindingsFromChecks, type CheckRow } from "../build-findings";

const baseFinding = {
  id: "https:https-ontbreekt",
  check_id: "https",
  category: "http" as const,
  severity: "high" as const,
  title: "HTTPS ontbreekt",
  description: "De site forceert geen HTTPS.",
  remediation: "Regel een TLS-certificaat.",
  evidence: null,
  active: false,
  status: "open" as const,
  note: null,
  created_at: "2026-08-17T10:00:00.000Z",
};

function row(overrides: Partial<CheckRow> = {}): CheckRow {
  return {
    check_id: "https",
    category: "http",
    status: "fail",
    severity: "high",
    finding: baseFinding,
    ...overrides,
  };
}

describe("buildFindingsFromChecks", () => {
  it("bouwt een v1-payload uit geldige checks-rijen", () => {
    const payload = buildFindingsFromChecks([row()]);
    expect(payload).toMatchObject({ v: 1, items: [baseFinding] });
    expect(findingsPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("slaat rijen zonder finding en ongeldige finding-payloads over", () => {
    const payload = buildFindingsFromChecks([
      row({ finding: null }),
      row({ finding: { not: "a finding" } }),
      row(),
    ]);
    expect(payload).toMatchObject({ v: 1, items: [baseFinding] });
  });

  it("sorteert findings van kritiek naar info", () => {
    const payload = findingsPayloadSchema.parse(buildFindingsFromChecks([
      row({
        check_id: "meta-tags",
        severity: "low",
        finding: { ...baseFinding, id: "meta-tags:meta-onvolledig", severity: "low" },
      }),
      row({
        check_id: "secrets-in-bundles",
        severity: "critical",
        finding: {
          ...baseFinding,
          id: "secrets-in-bundles:api-key",
          severity: "critical",
        },
      }),
      row(),
    ]));
    expect(payload.items.map((i) => i.id)).toEqual([
      "secrets-in-bundles:api-key",
      "https:https-ontbreekt",
      "meta-tags:meta-onvolledig",
    ]);
  });
});
import { describe, it, expect, vi } from "vitest";
import { queryFindings, type FindingsPage } from "../findings-core";
import type { Finding, FindingsQuery, FindingsPayload } from "@scanpal/shared";

vi.mock("server-only", () => ({}));

function makeItem(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "check:title",
    check_id: "check",
    category: "http",
    severity: "medium",
    title: "Title",
    description: "Beschrijving",
    remediation: "Los het op",
    evidence: null,
    active: false,
    status: "open",
    note: null,
    created_at: "2026-08-15T09:00:00.000Z",
    route_url: null,
    ...overrides,
  };
}

function makePayload(items: Finding[]): FindingsPayload {
  return { v: 1, items };
}

function query(overrides: Partial<FindingsQuery> = {}): FindingsQuery {
  return {
    sort: "severity",
    order: "desc",
    limit: 50,
    offset: 0,
    ...overrides,
  };
}

function expectEmpty(page: FindingsPage) {
  expect(page.findings).toEqual([]);
  expect(page.total).toBe(0);
  expect(page.counts).toEqual({
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  });
}

describe("queryFindings", () => {
  it("geeft een lege pagina voor legacy-data (geen v1-payload)", () => {
    expectEmpty(queryFindings({ checks: [] }, query()));
    expectEmpty(queryFindings({}, query()));
    expectEmpty(queryFindings({ v: 2, items: [] }, query()));
  });

  it("filtert op severity, categorie en status", () => {
    const payload = makePayload([
      makeItem({ id: "a", category: "http", severity: "critical", status: "open" }),
      makeItem({ id: "b", category: "seo", severity: "high", status: "open" }),
      makeItem({ id: "c", category: "http", severity: "critical", status: "fixed" }),
      makeItem({ id: "d", category: "github", severity: "low", status: "ignored" }),
    ]);

    const high = queryFindings(payload, query({ severity: "critical" }));
    expect(high.findings.map((f) => f.id)).toEqual(["a", "c"]);

    const seo = queryFindings(payload, query({ category: "seo" }));
    expect(seo.findings.map((f) => f.id)).toEqual(["b"]);

    const fixed = queryFindings(payload, query({ status: "fixed" }));
    expect(fixed.findings.map((f) => f.id)).toEqual(["c"]);
  });

  it("zoekt case-insensitief op title, description én evidence", () => {
    const payload = makePayload([
      makeItem({ id: "a", title: "HTTPS ontbreekt" }),
      makeItem({ id: "b", description: "Cookie mist HttpOnly vlag" }),
      makeItem({ id: "c", evidence: "AKIAIOSFODNN7EXAMPLE" }),
      makeItem({ id: "d", title: "Niets" }),
    ]);

    expect(queryFindings(payload, query({ q: "https" })).findings.map((f) => f.id)).toEqual(["a"]);
    expect(queryFindings(payload, query({ q: "httponly" })).findings.map((f) => f.id)).toEqual(["b"]);
    expect(queryFindings(payload, query({ q: "akia" })).findings.map((f) => f.id)).toEqual(["c"]);
    expect(queryFindings(payload, query({ q: "b" })).findings.map((f) => f.id)).toEqual(["a", "c", "d"]);
  });

  it("telt counts per severity over status/q/categorie, onafhankelijk van paginering", () => {
    const items = [
      makeItem({ id: "a", severity: "critical", status: "open" }),
      makeItem({ id: "b", severity: "critical", status: "fixed" }),
      makeItem({ id: "c", severity: "high", status: "open" }),
      makeItem({ id: "d", severity: "medium", status: "open", category: "seo" }),
    ];
    const payload = makePayload(items);

    const page1 = queryFindings(payload, query({ limit: 1, offset: 0 }));
    const page2 = queryFindings(payload, query({ limit: 1, offset: 1 }));
    expect(page1.counts).toEqual({ critical: 2, high: 1, medium: 1, low: 0, info: 0 });
    expect(page2.counts).toEqual(page1.counts);
    expect(page1.total).toBe(4);
    expect(page2.total).toBe(4);

    const open = queryFindings(payload, query({ status: "open" }));
    expect(open.counts).toEqual({ critical: 1, high: 1, medium: 1, low: 0, info: 0 });

    const seo = queryFindings(payload, query({ category: "seo" }));
    expect(seo.counts).toEqual({ critical: 0, high: 0, medium: 1, low: 0, info: 0 });
  });

  it("sorteert standaard op ernst (critical eerst), en op created_at/title", () => {
    const payload = makePayload([
      makeItem({ id: "a", severity: "low", title: "Zzz" }),
      makeItem({ id: "b", severity: "critical", title: "Aaa" }),
      makeItem({ id: "c", severity: "medium", title: "Mmm" }),
    ]);

    expect(queryFindings(payload, query()).findings.map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(
      queryFindings(payload, query({ sort: "title", order: "asc" })).findings.map((f) => f.id),
    ).toEqual(["b", "c", "a"]);
    expect(
      queryFindings(payload, query({ sort: "title", order: "desc" })).findings.map((f) => f.id),
    ).toEqual(["a", "c", "b"]);
  });

  it("paginaert met limit/offset en geeft de categorieën in de scan terug", () => {
    const payload = makePayload([
      makeItem({ id: "a", category: "http" }),
      makeItem({ id: "b", category: "seo" }),
      makeItem({ id: "c", category: "http" }),
    ]);

    const page = queryFindings(payload, query({ limit: 2, offset: 0 }));
    expect(page.findings.map((f) => f.id)).toEqual(["a", "b"]);
    expect(page.total).toBe(3);
    expect(page.categories).toEqual(["http", "seo"]);

    const rest = queryFindings(payload, query({ limit: 2, offset: 2 }));
    expect(rest.findings.map((f) => f.id)).toEqual(["c"]);
    expect(rest.categories).toEqual(["http", "seo"]);
  });

  it("filtert op bundel-secret key_type (plan 53) en levert key_types terug", () => {
    const bundleEvidence = {
      kind: "bundle-secrets" as const,
      matches: [
        {
          key_type: "stripe_secret_key" as const,
          provider: "stripe" as const,
          file: "https://example.com/app.js",
          sourcemap: false,
          match_preview: "sk_l…cdef",
          severity: "critical" as const,
        },
      ],
      notes: [],
    };
    const payload = makePayload([
      makeItem({ id: "a", evidence: bundleEvidence }),
      makeItem({ id: "b", evidence: null }),
    ]);

    const page = queryFindings(payload, query());
    expect(page.key_types).toEqual(["stripe_secret_key"]);

    const filtered = queryFindings(payload, query({ key_type: "stripe_secret_key" }));
    expect(filtered.findings.map((f) => f.id)).toEqual(["a"]);

    const none = queryFindings(payload, query({ key_type: "openai_api_key" }));
    expect(none.findings).toEqual([]);
  });
});

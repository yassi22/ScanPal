import { describe, it, expect } from "vitest";
import {
  applyFindingStatusCarryOver,
  countSeverities,
  findingId,
  findingsPayloadSchema,
  findingsQuerySchema,
  findingSchema,
  inlineChecksToFindings,
  severityOrder,
  severityRank,
  type Finding,
  type FindingsPayload,
} from "../findings";

const NOW = "2026-08-15T09:00:00.000Z";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "check:title",
    check_id: "check",
    category: "http",
    severity: "high",
    title: "Title",
    description: "Beschrijving",
    remediation: "Los het op",
    evidence: null,
    active: false,
    status: "open",
    note: null,
    created_at: NOW,
    route_url: null,
    regressed: false,
    snooze_until: null,
    ...overrides,
  };
}

function makePayload(items: Finding[]): FindingsPayload {
  return { v: 1, items };
}

describe("findingsPayloadSchema", () => {
  it("valideert het v1-payload-formaat", () => {
    const payload = makePayload([makeFinding()]);
    const parsed = findingsPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("weigert een andere payload-versie", () => {
    const parsed = findingsPayloadSchema.safeParse({
      v: 2,
      items: [makeFinding()],
    });
    expect(parsed.success).toBe(false);
  });

  it("vult status met de default 'open'", () => {
    const parsed = findingsPayloadSchema.safeParse({
      v: 1,
      items: [{ ...makeFinding(), status: undefined }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items[0].status).toBe("open");
  });

  it("weigert een onbekende severity of status", () => {
    expect(
      findingsPayloadSchema.safeParse({
        v: 1,
        items: [{ ...makeFinding(), severity: "mega" }],
      }).success,
    ).toBe(false);
    expect(
      findingsPayloadSchema.safeParse({
        v: 1,
        items: [{ ...makeFinding(), status: "done" }],
      }).success,
    ).toBe(false);
  });
});

describe("findingSchema", () => {
  it("weigert een finding zonder geldige created_at", () => {
    expect(
      findingSchema.safeParse({ ...makeFinding(), created_at: "gisteren" })
        .success,
    ).toBe(false);
  });
});

describe("findingId", () => {
  it("bouwt `${check_id}:${title-slug}`", () => {
    expect(findingId("security-header-csp", "Content-Security-Policy ontbreekt")).toBe(
      "security-header-csp:content-security-policy-ontbreekt",
    );
    expect(findingId("meta-tags", "Meta & OG-tags")).toBe(
      "meta-tags:meta-og-tags",
    );
  });

  it("is deterministisch voor dezelfde input", () => {
    expect(findingId("https", "HTTPS ontbreekt")).toBe(
      findingId("https", "HTTPS ontbreekt"),
    );
  });

  it("verwijdert niet-ASCII tekens (bijv. accenten)", () => {
    expect(findingId("check", "Café menu")).toBe("check:cafe-menu");
  });
});

describe("inlineChecksToFindings", () => {
  it("mappt pass → info, warn → medium, fail → high", () => {
    const items = inlineChecksToFindings(
      [
        { id: "reachability", name: "Reachability", status: "pass", detail: "ok" },
        { id: "https", name: "HTTPS", status: "fail", detail: "geen https" },
        { id: "security-header-xcto", name: "X-Content-Type-Options", status: "warn", detail: "ontbreken" },
      ],
      NOW,
    );

    expect(items.map((f) => f.severity)).toEqual(["info", "high", "medium"]);
    expect(items.map((f) => f.status)).toEqual(["open", "open", "open"]);
    expect(items.map((f) => f.category)).toEqual(["http", "http", "http"]);
    expect(items.map((f) => f.created_at)).toEqual([NOW, NOW, NOW]);
  });

  it("geeft elke finding een remediatie en description uit de check", () => {
    const items = inlineChecksToFindings(
      [{ id: "https", name: "HTTPS", status: "fail", detail: "geen tls" }],
      NOW,
    );
    expect(items[0].description).toBe("geen tls");
    expect(items[0].remediation.length).toBeGreaterThan(0);
  });

  it("gebruikt een beschrijvende titel bij warn/fail en de check-naam bij pass", () => {
    const items = inlineChecksToFindings(
      [
        { id: "reachability", name: "Reachability", status: "pass", detail: "" },
        { id: "reachability", name: "Reachability", status: "fail", detail: "" },
      ],
      NOW,
    );
    expect(items[0].title).toBe("Reachability");
    expect(items[1].title).toBe("Site is niet bereikbaar");
  });

  it("produceert unieke, stabiele ids binnen dezelfde checks", () => {
    const items = inlineChecksToFindings(
      [
        { id: "reachability", name: "Reachability", status: "pass", detail: "a" },
        { id: "https", name: "HTTPS", status: "pass", detail: "b" },
        { id: "meta-tags", name: "Meta & OG-tags", status: "warn", detail: "c" },
      ],
      NOW,
    );
    const ids = items.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);

    const again = inlineChecksToFindings(
      [
        { id: "reachability", name: "Reachability", status: "pass", detail: "a" },
        { id: "https", name: "HTTPS", status: "pass", detail: "b" },
        { id: "meta-tags", name: "Meta & OG-tags", status: "warn", detail: "c" },
      ],
      NOW,
    );
    expect(again.map((f) => f.id)).toEqual(ids);
  });
});

describe("severity helpers", () => {
  it("ordent critical > high > medium > low > info", () => {
    expect(severityOrder).toEqual(["critical", "high", "medium", "low", "info"]);
    expect(severityRank.critical).toBeGreaterThan(severityRank.high);
    expect(severityRank.high).toBeGreaterThan(severityRank.medium);
    expect(severityRank.medium).toBeGreaterThan(severityRank.low);
    expect(severityRank.low).toBeGreaterThan(severityRank.info);
  });

  it("telt severities op", () => {
    expect(
      countSeverities([
        { severity: "critical" },
        { severity: "high" },
        { severity: "high" },
        { severity: "info" },
      ]),
    ).toEqual({ critical: 1, high: 2, medium: 0, low: 0, info: 1 });
  });
});

describe("inlineChecksToFindings — route-bewust (plan 54)", () => {
  it("stempelt route_url op de finding wanneer routeUrl is meegegeven", () => {
    const items = inlineChecksToFindings(
      [{ id: "security-header-csp", name: "CSP", status: "fail", detail: "ontbreekt" }],
      NOW,
      "https://example.com/about",
    );
    expect(items[0].route_url).toBe("https://example.com/about");
  });

  it("maakt de id route-bewust — zelfde check op twee routes geeft unieke ids", () => {
    const about = inlineChecksToFindings(
      [{ id: "security-header-csp", name: "CSP", status: "fail", detail: "ontbreekt" }],
      NOW,
      "https://example.com/about",
    )[0];
    const contact = inlineChecksToFindings(
      [{ id: "security-header-csp", name: "CSP", status: "fail", detail: "ontbreekt" }],
      NOW,
      "https://example.com/contact",
    )[0];
    expect(about.id).not.toBe(contact.id);
    expect(about.id).toContain("example.com/about");
    expect(contact.id).toContain("example.com/contact");
  });

  it("laat route_url null en de id ongewijzigd zonder routeUrl", () => {
    const items = inlineChecksToFindings(
      [{ id: "reachability", name: "Reachability", status: "pass", detail: "ok" }],
      NOW,
    );
    expect(items[0].route_url).toBeNull();
    expect(items[0].id).toBe("reachability:reachability");
  });
});

describe("applyFindingStatusCarryOver", () => {
  const current = makePayload([
    makeFinding({ id: "a:fixed", severity: "high", status: "open" }),
    makeFinding({ id: "b:ignored", severity: "medium", status: "open" }),
    makeFinding({ id: "c:open", severity: "low", status: "open" }),
    makeFinding({ id: "d:nieuw", severity: "info", status: "open" }),
  ]);

  const previous = makePayload([
    makeFinding({ id: "a:fixed", severity: "high", status: "fixed" }),
    makeFinding({
      id: "b:ignored",
      severity: "medium",
      status: "ignored",
      note: "bekend probleem",
    }),
    makeFinding({ id: "c:open", severity: "low", status: "open" }),
    makeFinding({ id: "oud:verdwenen", severity: "high", status: "fixed" }),
  ]);

  it("behoudt fixed/ignored + note en reset open", () => {
    const carried = applyFindingStatusCarryOver(current, previous);
    const byId = new Map(carried.items.map((f) => [f.id, f]));

    expect(byId.get("a:fixed")?.status).toBe("fixed");
    expect(byId.get("b:ignored")?.status).toBe("ignored");
    expect(byId.get("b:ignored")?.note).toBe("bekend probleem");
    expect(byId.get("c:open")?.status).toBe("open");
    expect(byId.get("d:nieuw")?.status).toBe("open");
  });

  it("is een no-op zonder vorige scan", () => {
    expect(applyFindingStatusCarryOver(current, null)).toEqual(current);
  });
});

describe("findingsQuerySchema", () => {
  it("heeft de default filter-waarden", () => {
    const parsed = findingsQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sort).toBe("severity");
      expect(parsed.data.order).toBe("desc");
      expect(parsed.data.limit).toBe(50);
      expect(parsed.data.offset).toBe(0);
    }
  });

  it("coercet limit en offset naar getallen", () => {
    const parsed = findingsQuerySchema.safeParse({ limit: "10", offset: "5" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(10);
      expect(parsed.data.offset).toBe(5);
    }
  });

  it("weigert een ongeldige limit (> 200) en onbekende filters", () => {
    expect(findingsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(findingsQuerySchema.safeParse({ severity: "mega" }).success).toBe(false);
    expect(findingsQuerySchema.safeParse({ sort: "datum" }).success).toBe(false);
  });
});

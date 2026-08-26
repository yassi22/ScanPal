import { describe, it, expect } from "vitest";
import {
  detectReportingHeaders,
  detectBeacons,
  classifyObservability,
  observabilityEvidence,
  collectObservabilitySignals,
  observabilityEvidenceSchema,
} from "../observability";
import type { HeaderSource } from "../stack-detection";

function headersFrom(map: Record<string, string>): HeaderSource {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("detectReportingHeaders", () => {
  it("detecteert Report-To, NEL en Reporting-Endpoints", () => {
    const h = headersFrom({
      "report-to": '{"group":"default"}',
      nel: '{"report_to":"default"}',
      "reporting-endpoints": "default=/report",
    });
    expect(detectReportingHeaders(h)).toEqual(
      expect.arrayContaining(["Report-To", "NEL", "Reporting-Endpoints"]),
    );
  });

  it("detecteert CSP report-uri/report-to directive", () => {
    const h = headersFrom({
      "content-security-policy": "default-src 'self'; report-uri /csp-report",
    });
    expect(detectReportingHeaders(h)).toContain("CSP reporting");
  });

  it("geeft een lege lijst zonder reporting-headers", () => {
    expect(detectReportingHeaders(headersFrom({ server: "nginx" }))).toEqual([]);
  });
});

describe("detectBeacons", () => {
  it("herkent Sentry uit een script-src", () => {
    expect(
      detectBeacons(
        '<script src="https://browser.sentry-cdn.com/7.0/bundle.min.js"></script>',
      ),
    ).toContain("Sentry");
  });

  it("herkent meerdere vendors", () => {
    const html = "window.DD_RUM.init(); LogRocket.init('org/app');";
    expect(detectBeacons(html)).toEqual(
      expect.arrayContaining(["Datadog RUM", "LogRocket"]),
    );
  });

  it("dedupliceert dezelfde vendor uit meerdere markers", () => {
    const html = "sentry-cdn.com ... @sentry/browser ... Sentry.init({})";
    expect(detectBeacons(html)).toEqual(["Sentry"]);
  });

  it("geeft een lege lijst zonder beacons", () => {
    expect(detectBeacons("<h1>hallo</h1>")).toEqual([]);
  });
});

describe("classifyObservability", () => {
  it("levert een pass met de gevonden signalen in de detail bij >=1 signaal", () => {
    const r = classifyObservability({
      reporting_headers: ["NEL"],
      beacons: ["Sentry"],
      security_txt: false,
    });
    expect(r.severity).toBe("info");
    expect(r.status).toBe("pass");
    expect(r.detail).toContain("NEL");
    expect(r.detail).toContain("Sentry");
  });

  it("straft afwezigheid niet (severity blijft info) en toont de disclaimer", () => {
    const r = classifyObservability({
      reporting_headers: [],
      beacons: [],
      security_txt: false,
    });
    expect(r.severity).toBe("info");
    expect(r.status).toBe("info");
    expect(r.detail.toLowerCase()).toContain("bewijst niet");
  });
});

describe("observabilityEvidence", () => {
  it("bouwt een geldige kind=observability evidence", () => {
    const ev = observabilityEvidence({
      reporting_headers: ["NEL"],
      beacons: ["Sentry"],
      security_txt: true,
    });
    expect(ev).toEqual({
      kind: "observability",
      reporting_headers: ["NEL"],
      beacons: ["Sentry"],
      security_txt: true,
    });
    expect(observabilityEvidenceSchema.parse(ev)).toEqual(ev);
  });
});

describe("collectObservabilitySignals", () => {
  it("combineert headers, tekst en security.txt tot één signalen-object", () => {
    const signals = collectObservabilitySignals(
      headersFrom({ nel: '{"report_to":"default"}' }),
      '<script src="https://browser.sentry-cdn.com/7/bundle.js"></script>',
      true,
    );
    expect(signals.reporting_headers).toContain("NEL");
    expect(signals.beacons).toContain("Sentry");
    expect(signals.security_txt).toBe(true);
  });
});

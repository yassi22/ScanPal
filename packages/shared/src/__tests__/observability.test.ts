import { describe, it, expect } from "vitest";
import {
  classifyObservability,
  detectObservabilityBeacons,
  detectReportingHeaders,
  observabilityEvidence,
} from "../observability";
import type { HeaderSource } from "../stack-detection";

function headersFrom(map: Record<string, string>): HeaderSource {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("detectReportingHeaders", () => {
  it("herkent report-uri in CSP", () => {
    const found = detectReportingHeaders(
      headersFrom({ "content-security-policy": "default-src 'self'; report-uri /csp-report" }),
    );
    expect(found).toContain("csp-report-uri");
  });

  it("herkent report-to in CSP", () => {
    const found = detectReportingHeaders(
      headersFrom({ "content-security-policy": "default-src 'self'; report-to csp-endpoint" }),
    );
    expect(found).toContain("csp-report-to");
  });

  it("herkent report-uri in CSP-Report-Only", () => {
    const found = detectReportingHeaders(
      headersFrom({ "content-security-policy-report-only": "default-src 'self'; report-uri /csp-report" }),
    );
    expect(found).toContain("csp-report-uri");
  });

  it("herkent losse Report-To-header", () => {
    const found = detectReportingHeaders(
      headersFrom({ "report-to": '{"group":"default","max_age":10886400,"endpoints":[{"url":"https://example.com/reports"}]}' }),
    );
    expect(found).toContain("report-to-header");
  });

  it("herkent NEL-header", () => {
    const found = detectReportingHeaders(
      headersFrom({ nel: '{"report_to":"default","max_age":2592000}' }),
    );
    expect(found).toContain("nel-header");
  });

  it("leest report-uri uit CSP-Report-Only óók als de enforcing CSP geen reporting heeft", () => {
    // Regressie: enforcing CSP en Report-Only zijn twee losse headers die
    // allebei kunnen voorkomen; de eerst-aanwezige kiezen zou de tweede
    // missen.
    const found = detectReportingHeaders(
      headersFrom({
        "content-security-policy": "default-src 'self'",
        "content-security-policy-report-only": "default-src 'self'; report-uri /csp-report",
      }),
    );
    expect(found).toContain("csp-report-uri");
  });

  it("geeft lege array zonder reporting-headers", () => {
    const found = detectReportingHeaders(headersFrom({ "content-security-policy": "default-src 'self'" }));
    expect(found).toEqual([]);
  });
});

describe("detectObservabilityBeacons", () => {
  it("herkent Sentry uit script-URL", () => {
    const html = '<script src="https://browser.sentry-cdn.com/7.0.0/bundle.min.js"></script>';
    expect(detectObservabilityBeacons(html)).toContain("Sentry");
  });

  it("herkent Datadog RUM uit inline init", () => {
    const html = "<script>window.DD_RUM.init({});</script>";
    expect(detectObservabilityBeacons(html)).toContain("Datadog RUM");
  });

  it("herkent LogRocket uit CDN-URL", () => {
    const html = '<script src="https://cdn.lr-ingest.io/LogRocket.min.js"></script>';
    expect(detectObservabilityBeacons(html)).toContain("LogRocket");
  });

  it("herkent Bugsnag uit CDN-URL", () => {
    const html = '<script src="https://d2wy8f7a9ursnm.cloudfront.net/v7/bugsnag.min.js"></script>';
    expect(detectObservabilityBeacons(html)).toContain("Bugsnag");
  });

  it("herkent New Relic Browser uit agent-URL", () => {
    const html = '<script src="https://js-agent.newrelic.com/nr-loader-full.min.js"></script>';
    expect(detectObservabilityBeacons(html)).toContain("New Relic Browser");
  });

  it("herkent Rollbar uit CDN-URL", () => {
    const html = '<script src="https://cdn.rollbar.com/rollbarjs/refs/tags/v2.26.0/rollbar.min.js"></script>';
    expect(detectObservabilityBeacons(html)).toContain("Rollbar");
  });

  it("geeft lege array zonder bekende vendors", () => {
    expect(detectObservabilityBeacons("<html><body>hello</body></html>")).toEqual([]);
  });

  it("kan meerdere vendors tegelijk herkennen", () => {
    const html =
      '<script src="https://browser.sentry-cdn.com/bundle.js"></script>' +
      '<script src="https://cdn.rollbar.com/rollbar.min.js"></script>';
    const found = detectObservabilityBeacons(html);
    expect(found).toContain("Sentry");
    expect(found).toContain("Rollbar");
  });
});

describe("classifyObservability — niet-strafgevende severity-regel (besluit 3)", () => {
  it("≥1 signaal → status pass, severity info", () => {
    const result = classifyObservability({
      reporting_headers: ["csp-report-uri"],
      beacons: [],
      security_txt: false,
    });
    expect(result.status).toBe("pass");
    expect(result.severity).toBe("info");
    expect(result.detail).toContain("csp-report-uri");
  });

  it("beacon-signaal → status pass, severity info", () => {
    const result = classifyObservability({
      reporting_headers: [],
      beacons: ["Sentry"],
      security_txt: false,
    });
    expect(result.status).toBe("pass");
    expect(result.severity).toBe("info");
    expect(result.detail).toContain("Sentry");
  });

  it("alleen security.txt-Contact → status pass, severity info", () => {
    const result = classifyObservability({
      reporting_headers: [],
      beacons: [],
      security_txt: true,
    });
    expect(result.status).toBe("pass");
    expect(result.severity).toBe("info");
  });

  it("geen signalen → status info, severity low (NOOIT medium/high) + disclaimer", () => {
    const result = classifyObservability({
      reporting_headers: [],
      beacons: [],
      security_txt: false,
    });
    expect(result.status).toBe("info");
    expect(result.severity).toBe("low");
    expect(result.severity).not.toBe("medium");
    expect(result.severity).not.toBe("high");
    expect(result.detail).toContain(
      "bewijst NIET dat er geen audit-logging is",
    );
    expect(result.detail).toContain("van buitenaf onzichtbaar");
  });
});

describe("observabilityEvidence", () => {
  it("produceert evidence met kind + de drie signaal-velden", () => {
    const evidence = observabilityEvidence({
      reporting_headers: ["csp-report-uri"],
      beacons: ["Sentry"],
      security_txt: true,
    });
    expect(evidence.kind).toBe("observability-signals");
    expect(evidence.reporting_headers).toEqual(["csp-report-uri"]);
    expect(evidence.beacons).toEqual(["Sentry"]);
    expect(evidence.security_txt).toBe(true);
  });
});

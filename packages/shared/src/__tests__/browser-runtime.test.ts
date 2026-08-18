import { describe, it, expect } from "vitest";
import {
  parseConsoleMessages,
  parseRequestFailures,
  consoleEvidence,
  consoleOverallStatus,
  consoleEvidenceSchema,
  parseViewportIssues,
  parseTapTargetIssues,
  responsiveEvidence,
  responsiveOverallStatus,
  responsiveEvidenceSchema,
} from "../browser-runtime";
import { checkCatalog } from "../check-catalog";

describe("browser-runtime (features 44, 45)", () => {
  it("heeft catalog-entries console-errors en mobile-responsive (aeo, passief)", () => {
    const consoleEntry = checkCatalog.find((c) => c.id === "console-errors");
    expect(consoleEntry).toBeDefined();
    expect(consoleEntry?.category).toBe("aeo");
    expect(consoleEntry?.active).toBe(false);
    const responsiveEntry = checkCatalog.find((c) => c.id === "mobile-responsive");
    expect(responsiveEntry).toBeDefined();
    expect(responsiveEntry?.category).toBe("aeo");
    expect(responsiveEntry?.active).toBe(false);
  });

  // --- Feature 44 ---

  describe("parseConsoleMessages", () => {
    it("parseert messages met type, text, location", () => {
      const parsed = parseConsoleMessages([
        { type: "error", text: "Uncaught TypeError", location: "app.js:42" },
        { type: "warning", text: "Deprecation" },
      ]);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        type: "error",
        text: "Uncaught TypeError",
        location: "app.js:42",
      });
      expect(parsed[1]).toEqual({ type: "warning", text: "Deprecation" });
    });

    it("negeert ongeldige input", () => {
      expect(parseConsoleMessages(null)).toEqual([]);
      expect(parseConsoleMessages("geen-array")).toEqual([]);
      expect(parseConsoleMessages([{ type: "error" }])).toEqual([]);
    });

    it("normaliseert types (warn→warning, onbekend→log)", () => {
      const parsed = parseConsoleMessages([
        { type: "warn", text: "x" },
        { type: "verbose", text: "y" },
        { type: 42, text: "z" },
      ]);
      expect(parsed[0].type).toBe("warning");
      expect(parsed[1].type).toBe("log");
      expect(parsed[2].type).toBe("log");
    });
  });

  describe("parseRequestFailures", () => {
    it("parseert failed requests met url/method/status/error", () => {
      const parsed = parseRequestFailures([
        { url: "https://api.example.com/x", method: "POST", status: 500, error: "boom" },
        { url: "https://cdn.example.com/y", method: "GET" },
      ]);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        url: "https://api.example.com/x",
        method: "POST",
        status: 500,
        error: "boom",
      });
      expect(parsed[1].status).toBeNull();
      expect(parsed[1].method).toBe("GET");
    });

    it("negeert entries zonder url", () => {
      expect(parseRequestFailures([{ method: "GET" }])).toEqual([]);
    });
  });

  describe("consoleEvidence + consoleOverallStatus", () => {
    it("fail bij error-messages of failed-requests", () => {
      const capture = {
        messages: [{ type: "error" as const, text: "boom" }],
        failed_requests: [],
      };
      expect(consoleOverallStatus(capture)).toBe("fail");
      const ev = consoleEvidence(capture);
      expect(ev.kind).toBe("console-errors");
      expect(ev.by_type.error).toBe(1);
      expect(ev.failed_requests).toBe(0);
      expect(consoleEvidenceSchema.safeParse(ev).success).toBe(true);
    });

    it("fail bij failed-requests zonder console-errors", () => {
      const capture = {
        messages: [],
        failed_requests: [{ url: "https://x", method: "GET", status: 500 }],
      };
      expect(consoleOverallStatus(capture)).toBe("fail");
      expect(consoleEvidence(capture).failed_requests).toBe(1);
    });

    it("warn bij alleen warnings", () => {
      const capture = {
        messages: [{ type: "warning" as const, text: "deprecation" }],
        failed_requests: [],
      };
      expect(consoleOverallStatus(capture)).toBe("warn");
    });

    it("pass bij geen errors/warnings/failures", () => {
      const capture = {
        messages: [{ type: "info" as const, text: "hello" }],
        failed_requests: [],
      };
      expect(consoleOverallStatus(capture)).toBe("pass");
    });

    it("capteert samples op 10 error/warning-entries", () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        type: "error" as const,
        text: `err${i}`,
      }));
      const ev = consoleEvidence({ messages, failed_requests: [] });
      expect(ev.samples).toHaveLength(10);
    });
  });

  // --- Feature 45 ---

  describe("parseViewportIssues", () => {
    it("parseert viewport met width/height/horizontal_scroll/overflow_px", () => {
      const parsed = parseViewportIssues({
        width: 375,
        height: 667,
        horizontal_scroll: true,
        overflow_px: 12.4,
      });
      expect(parsed).toEqual({
        width: 375,
        height: 667,
        horizontal_scroll: true,
        overflow_px: 12,
      });
    });

    it("null bij ontbrekende width/height", () => {
      expect(parseViewportIssues(null)).toBeNull();
      expect(parseViewportIssues({ width: 0, height: 0 })).toBeNull();
    });
  });

  describe("parseTapTargetIssues", () => {
    it("behoudt alleen targets kleiner dan 24px", () => {
      const parsed = parseTapTargetIssues([
        { selector: "button.small", width_px: 18, height_px: 18 },
        { selector: "button.big", width_px: 40, height_px: 40 },
        { selector: "a.link", width_px: 20, height_px: 30 },
      ]);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].selector).toBe("button.small");
      expect(parsed[1].selector).toBe("a.link");
    });

    it("negeert ongeldige input", () => {
      expect(parseTapTargetIssues(null)).toEqual([]);
      expect(parseTapTargetIssues([{ width_px: 10 }])).toEqual([]);
    });

    it("capteert op 20 entries", () => {
      const many = Array.from({ length: 30 }, (_, i) => ({
        selector: `s${i}`,
        width_px: 10,
        height_px: 10,
      }));
      expect(parseTapTargetIssues(many)).toHaveLength(20);
    });
  });

  describe("responsiveEvidence + responsiveOverallStatus", () => {
    const mobile = { width: 375, height: 667, horizontal_scroll: false, overflow_px: 0 };
    const desktop = { width: 1280, height: 720, horizontal_scroll: false, overflow_px: 0 };

    it("fail bij mobile horizontal-scroll > 8px", () => {
      const capture = {
        mobile: { ...mobile, horizontal_scroll: true, overflow_px: 20 },
        desktop,
        tap_target_issues: [],
      };
      expect(responsiveOverallStatus(capture)).toBe("fail");
      const ev = responsiveEvidence(capture);
      expect(ev.kind).toBe("mobile-responsive");
      expect(ev.issues).toHaveLength(1);
      expect(responsiveEvidenceSchema.safeParse(ev).success).toBe(true);
    });

    it("pass bij geen mobile-overflow (overflow_px <= 8 geldt als ok)", () => {
      const capture = {
        mobile: { ...mobile, horizontal_scroll: true, overflow_px: 4 },
        desktop,
        tap_target_issues: [],
      };
      expect(responsiveOverallStatus(capture)).toBe("pass");
    });

    it("warn bij tap-target-issues", () => {
      const capture = {
        mobile,
        desktop,
        tap_target_issues: [{ selector: "button.small", width_px: 18, height_px: 18 }],
      };
      expect(responsiveOverallStatus(capture)).toBe("warn");
      const ev = responsiveEvidence(capture);
      expect(ev.tap_target_issues).toBe(1);
      expect(ev.samples).toHaveLength(1);
    });

    it("warn bij desktop horizontal-scroll", () => {
      const capture = {
        mobile,
        desktop: { ...desktop, horizontal_scroll: true, overflow_px: 5 },
        tap_target_issues: [],
      };
      expect(responsiveOverallStatus(capture)).toBe("warn");
    });

    it("pass bij alles goed", () => {
      const capture = { mobile, desktop, tap_target_issues: [] };
      expect(responsiveOverallStatus(capture)).toBe("pass");
      expect(responsiveEvidence(capture).issues).toHaveLength(0);
    });
  });
});

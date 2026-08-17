import { describe, it, expect, vi } from "vitest";
import { computeNextScanAt, next09Utc } from "../../lib/schedule";

vi.mock("server-only", () => ({}));

describe("next09Utc", () => {
  it("geeft de eerstvolgende 09:00 UTC strikt na het startpunt", () => {
    const from = new Date("2026-08-15T12:00:00Z");
    expect(next09Utc(from).toISOString()).toBe("2026-08-16T09:00:00.000Z");
  });

  it("schuift naar dezelfde dag als het startpunt voor 09:00 UTC ligt", () => {
    const from = new Date("2026-08-15T07:00:00Z");
    expect(next09Utc(from).toISOString()).toBe("2026-08-15T09:00:00.000Z");
  });

  it("behandelt exact 09:00 UTC als verstreken (morgen)", () => {
    const from = new Date("2026-08-15T09:00:00Z");
    expect(next09Utc(from).toISOString()).toBe("2026-08-16T09:00:00.000Z");
  });
});

describe("computeNextScanAt", () => {
  const now = new Date("2026-08-15T12:00:00Z");

  it("plant vanaf de vorige geplande tijd zonder drift (daily +1 dag)", () => {
    const current = new Date("2026-08-15T09:00:00Z");
    expect(computeNextScanAt("daily", current, now).toISOString()).toBe(
      "2026-08-16T09:00:00.000Z",
    );
  });

  it("plant weekly +7 dagen vanaf de vorige geplande tijd", () => {
    const current = new Date("2026-08-15T09:00:00Z");
    expect(computeNextScanAt("weekly", current, now).toISOString()).toBe(
      "2026-08-22T09:00:00.000Z",
    );
  });

  it("zonder huidige planning: eerstvolgende 09:00 UTC", () => {
    expect(computeNextScanAt("daily", null, now).toISOString()).toBe(
      "2026-08-16T09:00:00.000Z",
    );
  });

  it("corrigeert drift: ruim achtergelopen schema opnieuw plannen vanaf 09:00 UTC", () => {
    const current = new Date("2026-08-13T09:00:00Z");
    expect(computeNextScanAt("daily", current, now).toISOString()).toBe(
      "2026-08-16T09:00:00.000Z",
    );
  });

  it("corrigeert drift ook voor weekly", () => {
    const current = new Date("2026-07-01T09:00:00Z");
    expect(computeNextScanAt("weekly", current, now).toISOString()).toBe(
      "2026-08-16T09:00:00.000Z",
    );
  });

  it("eindigt nooit in het verleden", () => {
    const result = computeNextScanAt("daily", new Date("2020-01-01T09:00:00Z"), now);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });
});

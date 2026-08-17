import { describe, it, expect } from "vitest";
import {
  downSinceLabel,
  formatDateTime,
  formatDuration,
  formatLatency,
  formatUptimePct,
  hostOf,
  incidentDuration,
  statusLabel,
} from "../uptime-format";

describe("statusLabel", () => {
  it("geeft de Nederlandse status", () => {
    expect(statusLabel("up")).toBe("Online");
    expect(statusLabel("down")).toBe("Offline");
    expect(statusLabel("unknown")).toBe("Onbekend");
  });
});

describe("hostOf", () => {
  it("haalt het hostname uit een URL", () => {
    expect(hostOf("voorbeeld.nl")).toBe("voorbeeld.nl");
    expect(hostOf("https://www.voorbeeld.nl/pad")).toBe("www.voorbeeld.nl");
  });

  it("geeft de invoer terug bij een ongeldige URL", () => {
    expect(hostOf("niet geldig")).toBe("niet geldig");
  });
});

describe("formatUptimePct", () => {
  it("formatteert met komma", () => {
    expect(formatUptimePct(99.97)).toBe("99,97%");
    expect(formatUptimePct(100)).toBe("100%");
    expect(formatUptimePct(0)).toBe("0%");
  });

  it("geeft — bij null", () => {
    expect(formatUptimePct(null)).toBe("—");
  });
});

describe("formatLatency", () => {
  it("rondt af op hele ms", () => {
    expect(formatLatency(110.4)).toBe("110 ms");
    expect(formatLatency(110.6)).toBe("111 ms");
  });

  it("geeft — bij null", () => {
    expect(formatLatency(null)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("formatteert een datum", () => {
    expect(formatDateTime("2026-08-15T10:05:00.000Z")).toMatch(/15 aug/);
  });

  it("geeft — bij null", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("formatteert minuten, uren en dagen", () => {
    const now = Date.now();
    expect(formatDuration(now, now + 12 * 60000)).toBe("12 min");
    expect(formatDuration(now, now + 2 * 3600000 + 5 * 60000)).toBe("2 u 5 min");
    expect(formatDuration(now, now + 27 * 3600000 + 3 * 60000)).toBe("1 d 3 u");
  });

  it("kapt negatieve duur af op 0", () => {
    expect(formatDuration(Date.now() + 60000, Date.now())).toBe("0 min");
  });
});

describe("downSinceLabel", () => {
  it("geeft het label alleen bij down", () => {
    expect(
      downSinceLabel("down", "2026-08-15T10:05:00.000Z"),
    ).toContain("Down sinds");
    expect(downSinceLabel("up", "2026-08-15T10:05:00.000Z")).toBeNull();
    expect(downSinceLabel("down", null)).toBeNull();
  });
});

describe("incidentDuration", () => {
  it("berekent de duur van een afgelopen incident", () => {
    const duration = incidentDuration(
      "2026-08-15T10:00:00.000Z",
      "2026-08-15T10:12:00.000Z",
    );
    expect(duration).toBe("12 min");
  });

  it("rekent een lopend incident tot nu", () => {
    expect(incidentDuration("2026-08-16T09:00:00.000Z", null)).toMatch(
      /min|u|d/,
    );
  });
});

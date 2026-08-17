import { describe, it, expect } from "vitest";
import { transitionUptimeState } from "../state";

describe("transitionUptimeState", () => {
  describe("eerste probe ooit (unknown)", () => {
    it("succes → up", () => {
      const result = transitionUptimeState({
        previousState: "unknown",
        consecutiveFailures: 0,
        probeOk: true,
      });
      expect(result).toEqual({
        state: "up",
        changed: true,
        consecutiveFailures: 0,
      });
    });

    it("1e failure → direct down", () => {
      const result = transitionUptimeState({
        previousState: "unknown",
        consecutiveFailures: 0,
        probeOk: false,
      });
      expect(result).toEqual({
        state: "down",
        changed: true,
        consecutiveFailures: 1,
      });
    });
  });

  describe("site was up", () => {
    it("1e failure blijft up (2-failure-regel)", () => {
      const result = transitionUptimeState({
        previousState: "up",
        consecutiveFailures: 0,
        probeOk: false,
      });
      expect(result).toEqual({
        state: "down",
        changed: false,
        consecutiveFailures: 1,
      });
    });

    it("2e opeenvolgende failure → down", () => {
      const result = transitionUptimeState({
        previousState: "up",
        consecutiveFailures: 1,
        probeOk: false,
      });
      expect(result).toEqual({
        state: "down",
        changed: true,
        consecutiveFailures: 2,
      });
    });

    it("succes blijft up, telt failures terug naar 0", () => {
      const result = transitionUptimeState({
        previousState: "up",
        consecutiveFailures: 1,
        probeOk: true,
      });
      expect(result).toEqual({
        state: "up",
        changed: false,
        consecutiveFailures: 0,
      });
    });
  });

  describe("site was down", () => {
    it("failure blijft down", () => {
      const result = transitionUptimeState({
        previousState: "down",
        consecutiveFailures: 3,
        probeOk: false,
      });
      expect(result).toEqual({
        state: "down",
        changed: false,
        consecutiveFailures: 4,
      });
    });

    it("herstel na 1 succes → up", () => {
      const result = transitionUptimeState({
        previousState: "down",
        consecutiveFailures: 2,
        probeOk: true,
      });
      expect(result).toEqual({
        state: "up",
        changed: true,
        consecutiveFailures: 0,
      });
    });
  });
});

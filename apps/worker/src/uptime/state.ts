import type { SiteStatus } from "@scanpal/shared";

export type TransitionInput = {
  previousState: SiteStatus;
  /** trailing failures vóór deze probe (aantal opeenvolgende down-events) */
  consecutiveFailures: number;
  probeOk: boolean;
};

export type TransitionResult = {
  state: "up" | "down";
  changed: boolean;
  consecutiveFailures: number;
};

/**
 * Status-transitie (plan 11, invariant): down na 2 opeenvolgende failures,
 * up na 1 geslaagde probe; de allereerste probe bepaalt de initiële status
 * (1e failure → direct down).
 */
export function transitionUptimeState(input: TransitionInput): TransitionResult {
  if (input.probeOk) {
    return {
      state: "up",
      changed: input.previousState !== "up",
      consecutiveFailures: 0,
    };
  }

  const failures = input.consecutiveFailures + 1;

  if (input.previousState === "unknown") {
    return { state: "down", changed: true, consecutiveFailures: failures };
  }
  if (input.previousState === "down") {
    return { state: "down", changed: false, consecutiveFailures: failures };
  }
  return {
    state: "down",
    changed: failures >= 2,
    consecutiveFailures: failures,
  };
}

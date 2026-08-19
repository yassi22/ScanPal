import { describe, expect, it } from "vitest";
import type { ScanTrendPoint } from "@scanpal/shared";
import { getCompletedScoreHistory } from "../site-score-history";

function point(
  id: string,
  status: ScanTrendPoint["status"],
  score: number | null,
): ScanTrendPoint {
  return {
    id,
    status,
    score,
    category_scores: null,
    trigger: "manual",
    created_at: "2026-08-19T12:00:00.000Z",
    completed_at: status === "completed" ? "2026-08-19T12:01:00.000Z" : null,
  };
}

describe("getCompletedScoreHistory", () => {
  it("compares completed scans across an intervening failed scan", () => {
    const history = getCompletedScoreHistory([
      point("first", "completed", 61),
      point("failed", "failed", null),
      point("latest", "completed", 68),
    ]);

    expect(history.completedPoints.map(({ id }) => id)).toEqual(["first", "latest"]);
    expect(history.previous?.score).toBe(61);
    expect(history.latest?.score).toBe(68);
    expect(history.delta).toBe(7);
  });
});

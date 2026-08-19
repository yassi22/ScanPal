import type { ScanTrendPoint } from "@scanpal/shared";

export function getCompletedScoreHistory(points: ScanTrendPoint[]) {
  const completedPoints = points.filter(
    (point) => point.status === "completed" && point.score !== null,
  );
  const latest = completedPoints[completedPoints.length - 1] ?? null;
  const previous = completedPoints[completedPoints.length - 2] ?? null;

  return {
    completedPoints,
    latest,
    previous,
    delta:
      latest?.score !== null &&
      latest?.score !== undefined &&
      previous?.score !== null &&
      previous?.score !== undefined
        ? latest.score - previous.score
        : null,
  };
}

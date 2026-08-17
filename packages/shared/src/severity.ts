import { z } from "zod";

export const findingSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const severityOrder: FindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const severityRank: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};
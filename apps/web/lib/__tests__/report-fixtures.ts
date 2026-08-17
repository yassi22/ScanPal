import type { Finding, ReportData, SeverityCounts } from "@scanpal/shared";
import type { ReportRenderData } from "@/lib/report/data";

export const NOW = "2026-08-15T09:00:00.000Z";

export const EMPTY_OMITTED: SeverityCounts = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
};

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "check:title",
    check_id: "check",
    category: "http",
    severity: "info",
    title: "Title",
    description: "Description",
    remediation: "Fix it",
    evidence: null,
    active: false,
    status: "open",
    note: null,
    regressed: false,
    snooze_until: null,
    created_at: NOW,
    route_url: null,
    ...overrides,
  };
}

export function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    scan: {
      id: "00000000-0000-4000-8000-000000000001",
      trigger: "manual",
      created_at: NOW,
      completed_at: NOW,
    },
    site: { url: "example.com", label: "Example Site" },
    score: 80,
    category_scores: { http: 100, seo: 67, aeo: null, github: null },
    summary: { critical: 0, high: 1, medium: 2, low: 0, info: 3 },
    findings: [],
    ...overrides,
  };
}

export function makeRenderData(
  overrides: Partial<ReportData> = {},
  omitted: SeverityCounts = EMPTY_OMITTED,
  prompts?: string[],
): ReportRenderData {
  return { data: makeReportData(overrides), omitted, ...(prompts ? { prompts } : {}) };
}
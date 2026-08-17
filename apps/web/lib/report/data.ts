import "server-only";

import type { Pool } from "pg";
import {
  categoryScoresFromFindings,
  countSeverities,
  findingsPayloadSchema,
  severityOrder,
  severityRank,
  type Finding,
  type FindingSeverity,
  type FindingStatus,
  type ReportData,
  type ReportFormat,
  type ScanCategory,
  type ScanTrigger,
  type SeverityCounts,
} from "@scanpal/shared";

export const REPORT_MAX_PER_SEVERITY = 100;

export type BuildReportDataResult =
  | { ok: true; data: ReportData; siteId: string; omitted: SeverityCounts; githubRepo: string | null }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_completed"; status: string };

/** Data + afgekapte aantallen per ernst — wat beide renderers nodig hebben. */
export type ReportRenderData = {
  data: ReportData;
  omitted: SeverityCounts;
  /** Plan 60: optioneel gegenereerde AI fix-prompts per finding (Engels). */
  prompts?: string[];
};

/**
 * Eén gedeelde rapport-data-builder (besluit 2): een team-scoped query naar
 * scan + site, findings-parsing via het versioned schema (plan 09),
 * categorie-scores via `categoryScoresFromFindings`, findings gesorteerd op
 * ernst (critical → info) en beperkt tot top-100 per ernst. De route leidt de
 * `omitted`-tellingen af voor de "… and N more"-regel.
 */
export async function buildReportData(
  db: Pool,
  scanId: string,
  teamId: string,
): Promise<BuildReportDataResult> {
  const result = await db.query(
    `select s.id, s.status, s.score, s.findings, s.trigger, s.created_at,
            s.completed_at, st.id as site_id, st.url as site_url, st.label as site_label,
            st.github_repo
     from scans s
     join sites st on st.id = s.site_id
     where s.id = $1 and st.team_id = $2`,
    [scanId, teamId],
  );
  if (result.rowCount === 0) return { ok: false, reason: "not_found" };

  const row = result.rows[0];
  if (row.status !== "completed") {
    return { ok: false, reason: "not_completed", status: row.status };
  }

  const parsed = findingsPayloadSchema.safeParse(row.findings ?? {});
  const all = parsed.success ? parsed.data.items : [];
  const { sorted, omitted } = sortBySeverityCap(all);

  return {
    ok: true,
    siteId: row.site_id,
    githubRepo: row.github_repo ?? null,
    omitted,
    data: {
      scan: {
        id: row.id,
        trigger: row.trigger,
        created_at: new Date(row.created_at).toISOString(),
        completed_at: new Date(row.completed_at).toISOString(),
      },
      site: { url: row.site_url, label: row.site_label },
      score: row.score ?? 0,
      category_scores: categoryScoresFromFindings(all),
      summary: countSeverities(all.filter((item) => !item.active)),
      findings: sorted,
    },
  };
}

/** Sorteert op ernst (critical → info) en per ernst stabiel op titel. */
function sortFindings(items: Finding[]): Finding[] {
  return [...items].sort((a, b) => {
    const diff = severityRank[b.severity] - severityRank[a.severity];
    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title);
  });
}

/** Top-100 per ernst + telling van afgekapte items per ernst. */
export function sortBySeverityCap(items: Finding[]): {
  sorted: Finding[];
  omitted: SeverityCounts;
} {
  const omitted: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const sorted: Finding[] = [];
  for (const severity of severityOrder) {
    const bucket = sortFindings(items.filter((item) => item.severity === severity));
    if (bucket.length > REPORT_MAX_PER_SEVERITY) {
      omitted[severity] = bucket.length - REPORT_MAX_PER_SEVERITY;
    }
    sorted.push(...bucket.slice(0, REPORT_MAX_PER_SEVERITY));
  }
  return { sorted, omitted };
}

export function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

/** `scanpal-{site-host}-{scan-datum}.{ext}`, datum YYYY-MM-DD (UTC). */
export function reportFilename(
  siteUrl: string,
  completedAt: string,
  format: ReportFormat,
): string {
  const host = hostOf(siteUrl);
  const date = new Date(completedAt).toISOString().slice(0, 10);
  return `scanpal-${host}-${date}.${format}`;
}

/** Engelse ernst-label voor het rapport (taal: Engels, besluit 13). */
export const severityLabel: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const categoryLabelEn: Record<ScanCategory, string> = {
  http: "HTTP & Security",
  seo: "SEO & Content",
  aeo: "AEO & Browser",
  github: "GitHub & Repo",
};

export const triggerLabelEn: Record<ScanTrigger, string> = {
  manual: "Manual",
  schedule: "Scheduled",
  deploy: "Deploy",
};

export const statusLabelEn: Record<FindingStatus, string> = {
  open: "Open",
  fixed: "Fixed",
  ignored: "Ignored",
};
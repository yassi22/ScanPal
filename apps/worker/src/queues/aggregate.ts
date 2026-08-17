import type { Pool } from "pg";
import type { NotifyInput } from "@scanpal/notify";
import {
  categoryScoresFromFindings,
  countAtOrAbove,
  findingsPayloadSchema,
  overallScoreFromFindings,
  scanDiffSchema,
  type SeverityCounts,
} from "@scanpal/shared";
import {
  buildFindingsFromChecks,
  emitScanFinishedNotifications,
  finishScan,
  type CheckRow,
} from "@scanpal/scan-core";
import type { ScanJobData } from "./index";

type AggregateRow = {
  site_id: string;
  team_id: string;
  url: string;
  label: string | null;
};

async function loadScanSite(db: Pool, scanId: string): Promise<AggregateRow | null> {
  const result = await db.query<AggregateRow>(
    `select sc.site_id, s.team_id, s.url, s.label
     from scans sc
     join sites s on s.id = sc.site_id
     where sc.id = $1`,
    [scanId],
  );
  return result.rowCount ? result.rows[0] : null;
}

async function previousScore(
  db: Pool,
  siteId: string,
  scanId: string,
): Promise<number | null> {
  const result = await db.query<{ score: number | null }>(
    `select score from scans
      where site_id = $1 and id != $2 and status = 'completed' and score is not null
      order by created_at desc
      limit 1`,
    [siteId, scanId],
  );
  return result.rowCount ? result.rows[0].score : null;
}

/**
 * Aggregator (plan 27, stap 7): draait pas als álle children compleet zijn
 * (flow-semantiek). Bouwt de finale findings-payload uit de `checks`-rijen,
 * valideert met `findingsPayloadSchema`, berekent overall + per-categorie
 * scores en roept `finishScan` (race-guard op canceled; schrijft ook de diff
 * t.o.v. de laatste schone snapshot, plan 59). Daarna notificaties:
 * scan_done + critical_finding (via de gedeelde helper) en één `scan_diff`-
 * alert bij daadwerkelijke verandering — alleen voor niet-handmatige scans
 * (plan 59, besluit 4): nieuwe/teruggekeerde bevindingen ≥ medium óf een
 * score-daling ≥ 5 punten. De oude `score_drop`-mail (plan 05) is hiermee
 * vervangen; gesnoozde findings tellen niet mee (alert_new/alert_regressed).
 */
export function createAggregateProcessor(
  db: Pool,
  notify: (input: NotifyInput) => Promise<unknown> | unknown,
  log: (line: string) => void = () => {},
) {
  return async function aggregateProcessor(job: { data: ScanJobData }): Promise<void> {
    const { scanId } = job.data;
    const scan = await loadScanSite(db, scanId);
    if (!scan) return;

    const checks = await db.query<CheckRow>(
      `select check_id, category, status, severity, finding
       from checks where scan_id = $1`,
      [scanId],
    );

    const findings = buildFindingsFromChecks(checks.rows);
    const parsed = findingsPayloadSchema.safeParse(findings);
    if (!parsed.success) {
      throw new Error("findings-payload voldoet niet aan het contract");
    }

    const categoryScores = categoryScoresFromFindings(parsed.data.items);
    const score = overallScoreFromFindings(parsed.data.items);

    const finished = await finishScan(db, {
      scanId,
      siteId: scan.site_id,
      status: "completed",
      score,
      findings,
      categoryScores,
    });

    if (finished.status === "canceled") {
      log(`aggregate: scan ${scanId} is gecanceld — niet overschreven`);
      return;
    }

    const siteName = scan.label ?? scan.url;
    await emitScanFinishedNotifications(
      db,
      {
        teamId: scan.team_id,
        siteId: scan.site_id,
        scanId,
        score: finished.score,
        findings: finished.findings,
      },
      notify,
    );

    await emitScanDiffAlert(db, notify, {
      scan,
      scanId,
      finished,
      siteName,
    });

    log(
      `aggregate: scan ${scanId} afgerond (${finished.status}, score ${finished.score ?? "—"})`,
    );
  };
}

type DiffAlertInput = {
  scan: AggregateRow;
  scanId: string;
  finished: { score: number | null; trigger: string; diff: Record<string, unknown> };
  siteName: string;
};

function totalCount(counts: SeverityCounts): number {
  return (
    counts.critical + counts.high + counts.medium + counts.low + counts.info
  );
}

/**
 * Diff-alert (plan 59, besluit 4): alleen voor niet-handmatige scans, en alleen
 * bij verandering boven de drempel — nieuwe/teruggekeerde bevindingen vanaf
 * medium, of een score-daling ≥ 5 punten. Gesnoozde findings zitten niet in
 * `alert_new`/`alert_regressed` (wél in de stored diff voor de view).
 */
async function emitScanDiffAlert(
  db: Pool,
  notify: (input: NotifyInput) => Promise<unknown> | unknown,
  input: DiffAlertInput,
): Promise<void> {
  if (input.finished.trigger === "manual") return;

  const diff = scanDiffSchema.safeParse(input.finished.diff);
  if (!diff.success) return;

  const newMediumPlus = countAtOrAbove(diff.data.alert_new, "medium");
  const regressedMediumPlus = countAtOrAbove(diff.data.alert_regressed, "medium");

  const previous = await previousScore(db, input.scan.site_id, input.scanId);
  const scoreDrop =
    previous !== null && input.finished.score !== null
      ? previous - input.finished.score
      : null;

  const hasNewOrRegressed = newMediumPlus > 0 || regressedMediumPlus > 0;
  const hasScoreDrop = scoreDrop !== null && scoreDrop >= 5;
  if (!hasNewOrRegressed && !hasScoreDrop) return;

  await notify({
    type: "scan_diff",
    teamId: input.scan.team_id,
    entityId: input.scanId,
    payload: {
      site_name: input.siteName,
      new_count: totalCount(diff.data.alert_new),
      resolved_count: totalCount(diff.data.resolved),
      regressed_count: totalCount(diff.data.alert_regressed),
      new_high: countAtOrAbove(diff.data.alert_new, "high"),
      regressed_high: countAtOrAbove(diff.data.alert_regressed, "high"),
      score_drop: hasScoreDrop ? scoreDrop : undefined,
      previous_score: hasScoreDrop ? previous : undefined,
      new_score: hasScoreDrop ? input.finished.score : undefined,
    },
  });
}

/**
 * Partial-failure-policy (plan 27, besluit 6): een child (of de aggregator
 * zelf) die na exhausted attempts faalt → de hele scan op `failed` (consistent
 * met het oude gedrag; de ontbrekende categorie wordt niet als 'niet gescand'
 * gecompenseerd). Gebruikt door het `failed`-event van de aggregate-queue.
 */
export async function markScanFailed(
  db: Pool,
  scanId: string,
  error: string,
): Promise<void> {
  const scan = await loadScanSite(db, scanId);
  if (!scan) return;
  await finishScan(db, {
    scanId,
    siteId: scan.site_id,
    status: "failed",
    findings: { error },
  });
}
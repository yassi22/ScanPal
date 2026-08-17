import type { Pool } from "pg";
import type { NotifyInput } from "@scanpal/notify";
import {
  categoryScoresFromFindings,
  findingsPayloadSchema,
  overallScoreFromFindings,
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
 * scores en roept `finishScan` (race-guard op canceled). Daarna notificaties:
 * scan_done + critical_finding (via de gedeelde helper), score_drop bij een
 * daling t.o.v. de vorige voltooide scan.
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

    const previous = await previousScore(db, scan.site_id, scanId);
    if (previous !== null && finished.score !== null && finished.score < previous) {
      await notify({
        type: "score_drop",
        teamId: scan.team_id,
        entityId: scanId,
        payload: {
          site_name: siteName,
          previous_score: previous,
          new_score: finished.score,
        },
      });
    }

    log(
      `aggregate: scan ${scanId} afgerond (${finished.status}, score ${finished.score ?? "—"})`,
    );
  };
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
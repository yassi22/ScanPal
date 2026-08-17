import type { Pool, PoolClient } from "pg";
import { computeNextScanAt } from "@scanpal/shared";
import { spendScheduleCredit, CreditLimitError } from "./credits";

export type DueSite = {
  id: string;
  team_id: string;
  url: string;
  scan_frequency: "daily" | "weekly";
  next_scan_at: Date;
};

export type NotifySite = {
  teamId: string;
  siteId: string;
  siteName: string;
};

export type SchedulerNotifier = {
  onCreditSkip(site: NotifySite): Promise<unknown> | unknown;
};

export type ProcessResult = {
  due: number;
  started: string[];
  creditSkipped: string[];
};

type QueuedRun = {
  site: DueSite;
  scanId: string;
};

async function setSiteScanState(
  client: PoolClient,
  siteId: string,
  patch: { scanId: string; status: string },
): Promise<void> {
  await client.query(
    `update sites
       set last_scan_id = $1,
           last_scan_status = $2,
           last_scanned_at = now()
     where id = $3`,
    [patch.scanId, patch.status, siteId],
  );
}

/**
 * Eén poll-rondje (plan 05, besluit: DB-gedreven schema): due sites locken
 * (`for update skip locked`), overlap uitsluiten, credit afboeken, scan
 * aanmaken en enqueue `scan.dispatcher` (plan 27, besluit 7 — de worker-
 * pipeline voert de scan uit). Credit-skip notificatie blijft hier;
 * scan_failed/score_drop notificaties zitten nu bij de aggregator.
 */
export async function processDueSites(
  db: Pool,
  input: {
    now?: Date;
    enqueue: (scanId: string) => Promise<void>;
    notify: SchedulerNotifier;
  },
): Promise<ProcessResult> {
  const now = input.now ?? new Date();
  const result: ProcessResult = {
    due: 0,
    started: [],
    creditSkipped: [],
  };

  const client = await db.connect();
  const queued = new Map<string, QueuedRun>();
  const creditSkippedRuns: DueSite[] = [];

  try {
    await client.query("begin");

    const due = await client.query(
      `select id, team_id, url, scan_frequency, next_scan_at
       from sites
       where scan_frequency != 'none' and next_scan_at <= now()
       order by next_scan_at
       limit 50
       for update skip locked`,
    );
    const sites = due.rows as DueSite[];
    result.due = sites.length;

    for (const site of sites) {
      const next = computeNextScanAt(site.scan_frequency, site.next_scan_at, now);

      const active = await client.query(
        `select 1 from scans where site_id = $1 and status in ('queued', 'running') limit 1`,
        [site.id],
      );
      if (active.rowCount !== 0) {
        await client.query(
          "update sites set next_scan_at = $1 where id = $2",
          [next, site.id],
        );
        continue;
      }

      try {
        await spendScheduleCredit(client, {
          teamId: site.team_id,
          reason: "schedule",
        });
      } catch (err) {
        if (err instanceof CreditLimitError) {
          await client.query(
            "update sites set next_scan_at = $1 where id = $2",
            [next, site.id],
          );
          result.creditSkipped.push(site.id);
          creditSkippedRuns.push(site);
          continue;
        }
        throw err;
      }

      const inserted = await client.query(
        `insert into scans (site_id, status, trigger, scheduled_for)
         values ($1, 'queued', 'schedule', $2)
         returning id`,
        [site.id, site.next_scan_at],
      );
      const scanId = inserted.rows[0].id as string;

      await setSiteScanState(client, site.id, { scanId, status: "queued" });
      await client.query("update sites set next_scan_at = $1 where id = $2", [
        next,
        site.id,
      ]);

      queued.set(site.id, { site, scanId });
      result.started.push(site.id);
    }

    await client.query("commit");
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // transactie is mogelijk al beëindigd — negeren
    }
    client.release();
    throw err;
  }
  client.release();

  for (const skipped of creditSkippedRuns) {
    await input.notify.onCreditSkip({
      teamId: skipped.team_id,
      siteId: skipped.id,
      siteName: skipped.url,
    });
  }

  for (const run of queued.values()) {
    await input.enqueue(run.scanId);
  }

  return result;
}
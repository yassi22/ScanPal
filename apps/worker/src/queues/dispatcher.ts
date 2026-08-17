import type { Pool } from "pg";
import type { Queue } from "bullmq";
import type { QueueName } from "@scanpal/shared";
import { enqueueScanCrawl, writeProgressSkeleton } from "@scanpal/scan-core";
import type { ImplementedCheck } from "../checks/registry";
import { skeletonTotals } from "../checks/registry";
import type { ScanJobData } from "./index";

type DispatcherRow = {
  id: string;
  status: string;
  site_id: string;
  url: string;
  github_repo: string | null;
  active_tests: boolean;
};

async function loadScanSite(db: Pool, scanId: string): Promise<DispatcherRow | null> {
  const result = await db.query<DispatcherRow>(
    `select sc.id, sc.status, sc.site_id, s.url, s.github_repo, sc.active_tests
     from scans sc
     join sites s on s.id = sc.site_id
     where sc.id = $1`,
    [scanId],
  );
  return result.rowCount ? result.rows[0] : null;
}

/**
 * Dispatcher (plan 27, stap 5; plan 54 aanpassing): resolve scan+site, schrijf
 * het progress-skelet (progress 0, categorie-totalen uit de check-registry) en
 * enqueue `scan.crawl`. De crawler ontdekt routes, schrijft `scan_routes` en
 * maakt pas daarna de fan-out-flow aan (aggregate + http/browser/github) — de
 * checks draaien dus op de volledige route-lijst (plan 54, besluit 1: dispatcher
 * heeft een dependency op crawl). Job-name = scanId (crawl-queue) → idempotent.
 * Fout (bijv. scan bestaat niet / al canceled) → log + geen crawl.
 */
export function createDispatcherProcessor(
  db: Pool,
  crawlQueue: Queue,
  registry: Record<QueueName, ImplementedCheck[]>,
  log: (line: string) => void = () => {},
) {
  return async function dispatcherProcessor(job: { data: ScanJobData }): Promise<void> {
    const { scanId } = job.data;
    const scan = await loadScanSite(db, scanId);
    if (!scan) {
      log(`dispatcher: scan ${scanId} bestaat niet — geen crawl`);
      return;
    }
    if (scan.status === "canceled") {
      log(`dispatcher: scan ${scanId} is gecanceld — geen crawl`);
      return;
    }
    if (scan.status !== "queued") {
      log(`dispatcher: scan ${scanId} heeft status ${scan.status} — geen crawl`);
      return;
    }

    const includeGithub = Boolean(scan.github_repo);
    const queues: QueueName[] = includeGithub
      ? ["http", "browser", "github"]
      : ["http", "browser"];

    const totals = skeletonTotals(registry, queues, scan.active_tests);
    await writeProgressSkeleton(db, scanId, totals, new Date().toISOString());

    await enqueueScanCrawl(crawlQueue, scanId);
    log(`dispatcher: scan ${scanId} → crawl ge-enqueueued`);
  };
}
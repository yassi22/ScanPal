import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import {
  createScanDispatcherQueue,
  enqueueScanDispatcher,
  type Queue,
} from "@scanpal/scan-core";
import { startScanWorkers, type WorkerHandle } from "../queues/boot";

/**
 * E2E-integratietest voor de scan-pipeline (plan 27, stap 10). Vereist:
 *  - `E2E=1` in de omgeving (anders geskipt — draait niet in CI/local dev).
 *  - een draaiende postgres + redis met de migraties toegepast
 *    (`pnpm db:migrate`, `docker compose up -d postgres redis`).
 *  - internettoegang naar https://example.com (de workers scannen écht).
 *
 * Happy path: enqueue `scan.dispatcher` → children draaien → progress naar
 * 100 → de aggregator finaliseert `completed` met overall- en per-categorie-
 * scores. Cancel-pad: een scan cancelen middenin laat `canceled` staan.
 */
const enabled = process.env.E2E === "1";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://scanpal:scanpal@localhost:5432/scanpal";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const { Pool } = pg;

describe.skipIf(!enabled)("scan-pipeline E2E", () => {
  let pool: pg.Pool;
  let redis: Redis;
  let queue: Queue;
  let workers: WorkerHandle;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    queue = createScanDispatcherQueue(REDIS_URL);

    await pool.query("select 1");
    await redis.ping();

    workers = startScanWorkers({
      db: pool,
      redis,
      notify: () => undefined,
      log: (line) => console.log(line),
    });
  }, 30_000);

  afterAll(async () => {
    await workers?.close();
    await queue?.close();
    await pool?.end();
    await redis?.quit().catch(() => {});
  });

  async function createSite() {
    const siteId = crypto.randomUUID();
    const teamId = crypto.randomUUID();
    const scanId = crypto.randomUUID();

    await pool.query("insert into teams (id) values ($1) on conflict do nothing", [
      teamId,
    ]);
    await pool.query(
      `insert into sites (id, team_id, url)
       values ($1, $2, 'example.com')`,
      [siteId, teamId],
    );
    await pool.query(
      `insert into scans (id, site_id, status, trigger)
       values ($1, $2, 'queued', 'manual')`,
      [scanId, siteId],
    );
    return { teamId, siteId, scanId };
  }

  it(
    "draait de pipeline end-to-end naar completed met scores",
    async () => {
      const { scanId } = await createSite();
      await enqueueScanDispatcher(queue, scanId);

      const deadline = Date.now() + 90_000;
      let row: { status: string; progress: number; score: number | null; category_scores: unknown } | null = null;
      while (Date.now() < deadline) {
        const result = await pool.query(
          `select status, progress, score, category_scores from scans where id = $1`,
          [scanId],
        );
        row = result.rows[0];
        if (row?.status === "completed" || row?.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      expect(row?.status).toBe("completed");
      expect(row?.progress).toBe(100);
      expect(typeof row?.score).toBe("number");
      expect(row?.category_scores).not.toBeNull();

      const checks = await pool.query(
        "select check_id from checks where scan_id = $1",
        [scanId],
      );
      expect(checks.rowCount).toBeGreaterThan(0);
    },
    120_000,
  );

  it("laat een gecancelde scan gecanceled staan", async () => {
    const { scanId } = await createSite();
    await enqueueScanDispatcher(queue, scanId);

    // Cancel zodra de scan draait (status running) — de aggregator mag de
    // race-guard nooit overschrijven naar completed.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const result = await pool.query("select status from scans where id = $1", [
        scanId,
      ]);
      if (result.rows[0]?.status === "running") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await pool.query("update scans set status = 'canceled' where id = $1", [scanId]);

    await new Promise((r) => setTimeout(r, 10_000));
    const result = await pool.query("select status from scans where id = $1", [
      scanId,
    ]);
    expect(result.rows[0].status).toBe("canceled");
  }, 90_000);
});
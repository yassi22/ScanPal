import { Redis } from "ioredis";
import pg from "pg";
import { env } from "./env";
import { createNotifier } from "@scanpal/notify";
import { probeUrl, globalProbeGate } from "./probe";
import { pollAllSites } from "./poller";
import { runUptimeMaintenance } from "./maintenance";

const { Pool } = pg;

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

const notify = createNotifier({
  db: pool,
  resendApiKey: env.RESEND_API_KEY,
  resendFrom: env.RESEND_FROM,
  appUrl: env.APP_URL,
  log: console.log,
});

function probeGated(url: string) {
  return globalProbeGate.run(() => probeUrl(url, { timeoutMs: env.PROBE_TIMEOUT_MS }));
}

let ticking = false;
let maintenanceRunning = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const result = await pollAllSites({
      db: pool,
      redis,
      probe: probeGated,
      notify,
      log: (line) => console.log(line),
    });
    if (result.probed.length > 0 || result.failed.length > 0) {
      console.log(
        `uptime-poller: ${result.probed.length} geprobeerd · ` +
          `${result.skippedLocked.length} skip (lock) · ${result.failed.length} mislukt`,
      );
    }
  } catch (err) {
    console.error("uptime-poller tick mislukt:", err);
  } finally {
    ticking = false;
  }
}

async function maintenanceTick(): Promise<void> {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    const result = await runUptimeMaintenance({ db: pool, redis, log: console.log });
    if (result.rolledUpDays > 0 || result.deletedEvents > 0) {
      console.log(
        `uptime-maintenance: ${result.rolledUpDays} dagen gerolluped · ` +
          `${result.deletedEvents} events opgeruimd`,
      );
    }
  } catch (err) {
    console.error("uptime-maintenance mislukt:", err);
  } finally {
    maintenanceRunning = false;
  }
}

async function run(): Promise<void> {
  console.log(
    `uptime-poller gestart (poll elke ${env.POLL_INTERVAL_MS}ms, ` +
      `maintenance elke ${env.MAINTENANCE_INTERVAL_MS}ms)`,
  );

  await tick();
  const pollTimer = setInterval(() => {
    void tick();
  }, env.POLL_INTERVAL_MS);

  await maintenanceTick();
  const maintenanceTimer = setInterval(() => {
    void maintenanceTick();
  }, env.MAINTENANCE_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("uptime-poller: graceful shutdown…");
    clearInterval(pollTimer);
    clearInterval(maintenanceTimer);
    while (ticking || maintenanceRunning) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await redis.quit().catch(() => {});
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

run().catch((err) => {
  console.error("uptime-poller fatal:", err);
  process.exit(1);
});

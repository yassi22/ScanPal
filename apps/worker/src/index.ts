import { Redis } from "ioredis";
import pg from "pg";
import { env } from "./env";
import { createNotifier } from "@scanpal/notify";
import { startScanWorkers } from "./queues/boot";

const { Pool } = pg;

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const notify = createNotifier({
  db: pool,
  resendApiKey: env.RESEND_API_KEY,
  resendFrom: env.RESEND_FROM,
  appUrl: env.APP_URL,
  log: console.log,
});

async function run(): Promise<void> {
  console.log(`scan-pipeline-worker gestart (redis ${env.REDIS_URL})`);

  const handle = startScanWorkers({
    db: pool,
    redis,
    notify,
    log: (line) => console.log(line),
    routeConcurrency: env.PROBE_MAX_CONCURRENCY,
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("scan-pipeline-worker: graceful shutdown…");
    await handle.close();
    await redis.quit().catch(() => {});
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

run().catch((err) => {
  console.error("scan-pipeline-worker fatal:", err);
  process.exit(1);
});
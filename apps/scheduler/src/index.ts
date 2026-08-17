import pg from "pg";
import { env } from "./env";
import { createNotifier, createWebhookDeliverer } from "@scanpal/notify";
import { createScanDispatcherQueue, enqueueScanDispatcher, type Queue } from "@scanpal/scan-core";
import { processDueSites, type SchedulerNotifier } from "./core";
import { processDueDomainChecks, type DomainNotifier } from "./domain-watch";

const { Pool } = pg;

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });

const notifier = createNotifier({
  db: pool,
  resendApiKey: env.RESEND_API_KEY,
  resendFrom: env.RESEND_FROM,
  appUrl: env.APP_URL,
  log: console.log,
});

// Deliverer voor de webhook-outbox (plan 15, besluit 2): pre-BullMQ als
// loop in de scheduler; na Fase 3 wordt dit de BullMQ-queue webhook.deliver.
const deliverer = createWebhookDeliverer({
  db: pool,
  secretKey: env.WEBHOOK_SECRET_KEY ?? "",
  log: console.log,
  notify: notifier,
});

if (!env.WEBHOOK_SECRET_KEY) {
  console.warn("WEBHOOK_SECRET_KEY ontbreekt — webhook-deliveries kunnen niet worden ontsleuteld");
}

let dispatcherQueue: Queue | null = null;

const notify: SchedulerNotifier = {
  onCreditSkip: (site) =>
    notifier({
      type: "credit_skip",
      teamId: site.teamId,
      entityId: site.siteId,
      payload: { site_name: site.siteName },
    }),
};

// Plan 56: Domain Watchtower — dagelijkse domein-meting + alerts via de
// notificatiehub (domain_alert), in dezelfde scheduler-poll.
const domainNotify: DomainNotifier = ({ teamId, siteId, siteName, alert, checkedAt }) =>
  notifier({
    type: "domain_alert",
    teamId,
    entityId: siteId,
    incidentId: `${siteId}:${checkedAt.toISOString()}:${alert.field}`,
    payload: { site_name: siteName, field: alert.field, summary: alert.summary },
  });

/** Opruimen: in-app meldingen ouder dan 90 dagen (plan 13, besluit). */
async function cleanupOldNotifications(): Promise<number> {
  const result = await pool.query(
    "delete from notifications where created_at < now() - interval '90 days'",
  );
  return result.rowCount ?? 0;
}

async function tick(): Promise<void> {
  if (!dispatcherQueue) {
    dispatcherQueue = createScanDispatcherQueue(env.REDIS_URL);
  }

  const result = await processDueSites(pool, {
    enqueue: (scanId) => enqueueScanDispatcher(dispatcherQueue as Queue, scanId),
    notify,
  });

  if (result.due > 0) {
    console.log(
      `scheduler: ${result.due} due · ${result.started.length} gestart · ` +
        `${result.creditSkipped.length} credit-skip`,
    );
  }

  const delivery = await deliverer.deliverDue();
  if (delivery.attempted > 0) {
    console.log(
      `deliverer: ${delivery.attempted} deliveries · ${delivery.delivered} ok · ` +
        `${delivery.rejected} rejected · ${delivery.failed} mislukt · ` +
        `${delivery.disabled} uitgeschakeld`,
    );
  }

  const cleaned = await cleanupOldNotifications();
  if (cleaned > 0) {
    console.log(`scheduler: ${cleaned} notificaties opgeruimd (>90 dagen)`);
  }

  // Plan 56: Domain Watchtower — dagelijkse domein-meting.
  const domain = await processDueDomainChecks(pool, { notify: domainNotify });
  if (domain.due > 0) {
    console.log(
      `domain-watch: ${domain.due} due · ${domain.measured} gemeten · ` +
        `${domain.alerted} alerts`,
    );
  }
}

async function run() {
  console.log(`scheduler gestart (poll elke ${env.POLL_INTERVAL_MS}ms)`);
  try {
    await tick();
  } catch (err) {
    console.error("scheduler tick mislukt:", err);
  }
  setInterval(() => {
    tick().catch((err) => console.error("scheduler tick mislukt:", err));
  }, env.POLL_INTERVAL_MS);
}

run().catch((err) => {
  console.error("scheduler fatal:", err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
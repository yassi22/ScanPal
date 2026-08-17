import "server-only";

import { createNotifier } from "@scanpal/notify";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Gedeelde notificatiehub-instance van de webapp (plan 13). Gebruikt door de
 * scan-flow (scan_done + critical_finding) en straks door de dispatcher-
 * finish-handler (Fase 3); scheduler en uptime-poller hebben hun eigen
 * instance met hun eigen pool.
 */
export const notifier = createNotifier({
  db: pool,
  resendApiKey: env.resendApiKey,
  resendFrom: env.resendFrom,
  appUrl: env.appUrl,
  log: console.log,
});

import type { Pool } from "pg";
import type { NotifyInput } from "@scanpal/notify";
import { findingsPayloadSchema } from "@scanpal/shared";

export type ScanNotificationSender = (
  input: NotifyInput,
) => Promise<unknown> | unknown;

/**
 * Emit de scan-events naar de notificatiehub (plan 13): scan_done altijd bij
 * een completed scan, critical_finding alleen als er kritieke bevindingen
 * zijn. Wordt aangeroepen door de webapp-scan-flow en door de worker-
 * aggregator (plan 27) — het contract verandert niet. `send` is vereist
 * (webapp reikt haar eigen notifier aan; de worker bouwt zijn eigen
 * createNotifier-instance).
 */
export async function emitScanFinishedNotifications(
  db: Pool,
  input: {
    teamId: string;
    siteId: string;
    scanId: string;
    score: number | null;
    findings: Record<string, unknown>;
  },
  send: ScanNotificationSender,
): Promise<void> {
  const site = await db.query<{ url: string; label: string | null }>(
    "select url, label from sites where id = $1",
    [input.siteId],
  );
  if (site.rowCount === 0) return;
  const siteName = site.rows[0].label ?? site.rows[0].url;

  const parsed = findingsPayloadSchema.safeParse(input.findings);
  const criticalCount = parsed.success
    ? parsed.data.items.filter((item) => item.severity === "critical").length
    : 0;

  try {
    await send({
      type: "scan_done",
      teamId: input.teamId,
      entityId: input.scanId,
      payload: { site_name: siteName, score: input.score ?? 0 },
    });
    if (criticalCount > 0) {
      await send({
        type: "critical_finding",
        teamId: input.teamId,
        entityId: input.scanId,
        payload: { site_name: siteName, count: criticalCount },
      });
    }
  } catch (err) {
    console.error("scan-notificaties mislukt:", err);
  }
}
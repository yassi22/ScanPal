import { NextRequest } from "next/server";
import { scanProgressEventSchema } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { summarizeFindings } from "@/lib/scan-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 15000;
const MAX_STREAM_MS = 5 * 60 * 1000;
const GENERIC_FAILED_MESSAGE = "De scan is mislukt. Probeer het opnieuw.";

type ScanStreamRow = {
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  progress: number;
  progress_details: Record<string, unknown>;
  score: number | null;
  findings: Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sseFrame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const CATEGORY_KEYS = ["http", "seo", "aeo", "github"] as const;
const EMPTY_CATEGORY = {
  status: "pending",
  done: 0,
  total: 0,
  percent: 0,
  current_check: null,
};

/**
 * Vul ontbrekende categorieën aan (bv. bij een scan-rij met '{}'-default) —
 * het event-contract vereist alle vier de categorieën.
 */
function completeCategories(raw: Record<string, unknown>) {
  const categories: Record<string, unknown> = {};
  for (const key of CATEGORY_KEYS) {
    categories[key] = (raw[key] as Record<string, unknown> | undefined) ?? EMPTY_CATEGORY;
  }
  return categories;
}

/**
 * DB-gedreven SSE: pollt elke 2s de scans-rij en streamt progress-events;
 * heartbeat `: ping` elke 15s; sluit bij terminale status, na ~5 min of als de
 * client weg is. Zelfde authz als GET /api/scans/[id] (membership-join).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const scan = await pool.query<ScanStreamRow>(
    `select s.status, s.progress, s.progress_details, s.score, s.findings
     from scans s
     join sites st on st.id = s.site_id
     join memberships m on m.team_id = st.team_id
     where s.id = $1 and m.user_id = $2`,
    [id, user.id],
  );

  if (scan.rowCount === 0) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        const parsed = scanProgressEventSchema.safeParse(payload);
        if (!parsed.success) return;
        const { event, ...data } = parsed.data;
        controller.enqueue(encoder.encode(sseFrame(event, data)));
      };

      const close = () => controller.close();
      let sentFingerprint = "";

      const run = async () => {
        const startedAt = Date.now();
        let lastHeartbeatAt = startedAt;

        while (true) {
          if (request.signal.aborted) break;
          if (Date.now() - startedAt >= MAX_STREAM_MS) break;

          const row = await pool.query<ScanStreamRow>(
            `select s.status, s.progress, s.progress_details, s.score, s.findings
             from scans s
             join sites st on st.id = s.site_id
             join memberships m on m.team_id = st.team_id
             where s.id = $1 and m.user_id = $2`,
            [id, user.id],
          );
          const current = row.rows[0];
          if (!current) break;

          if (current.status === "completed") {
            send({
              event: "completed",
              scan_id: id,
              status: "completed",
              score: current.score,
              summary: summarizeFindings(current.findings),
            });
            break;
          }
          if (current.status === "failed") {
            send({
              event: "failed",
              scan_id: id,
              status: "failed",
              error:
                typeof current.findings?.error === "string"
                  ? current.findings.error
                  : GENERIC_FAILED_MESSAGE,
            });
            break;
          }
          if (current.status === "canceled") {
            send({
              event: "canceled",
              scan_id: id,
              status: "canceled",
            });
            break;
          }

          const fingerprint = JSON.stringify([
            current.status,
            current.progress,
            current.progress_details,
          ]);
          if (fingerprint !== sentFingerprint) {
            const details = current.progress_details as {
              checks_done?: number;
              checks_total?: number;
              categories?: Record<string, unknown>;
            };
            send({
              event: "progress",
              scan_id: id,
              status: current.status,
              progress: {
                overall: current.progress,
                checks_done: details.checks_done ?? 0,
                checks_total: details.checks_total ?? 0,
                categories: completeCategories(details.categories ?? {}),
              },
            });
            sentFingerprint = fingerprint;
          }

          const now = Date.now();
          if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
            controller.enqueue(encoder.encode(`: ping\n\n`));
            lastHeartbeatAt = now;
          }

          await sleep(POLL_INTERVAL_MS);
        }

        close();
      };

      run().catch((err) => {
        console.error("SSE-stream mislukt", err);
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

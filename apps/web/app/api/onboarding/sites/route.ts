import { NextResponse } from "next/server";
import { onboardingSiteInputSchema } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { normalizeUrl, runInlineProbe } from "@/lib/scan-runner";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = onboardingSiteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige URL" },
      { status: 400 },
    );
  }

  const { team } = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  const url = normalizeUrl(parsed.data.url);
  const client = await pool.connect();

  let site;
  let scan;
  try {
    await client.query("begin");

    site = await client.query(
      `insert into sites (team_id, url) values ($1, $2)
       on conflict (team_id, url) do update set url = excluded.url
       returning id, team_id, url`,
      [team.id, url],
    );

    scan = await client.query(
      "insert into scans (site_id, status) values ($1, 'queued') returning *",
      [site.rows[0].id],
    );

    if (env.scanMode === "inline") {
      const result = await runInlineProbe(url);
      scan = await client.query(
        `update scans set status = 'completed', progress = 100, score = $1, findings = $2, completed_at = now()
         where id = $3 returning *`,
        [result.score, JSON.stringify(result.findings), scan.rows[0].id],
      );
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    console.error("onboarding site mislukt", err);
    return NextResponse.json(
      { error: "Opslaan mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  return NextResponse.json(
    { site: site.rows[0], scan: scan.rows[0] },
    { status: scan.rows[0].status === "completed" ? 200 : 202 },
  );
}

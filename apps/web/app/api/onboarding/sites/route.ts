import { NextResponse } from "next/server";
import { onboardingSiteInputSchema, canonicalizeSiteUrl } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { getOrCreateUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { setSiteScanState } from "@/lib/sites-core";
import { enqueueScan } from "@/lib/scan-queue";
import type { ScanRowWithMeta } from "@/lib/scans-core";
import { spendCredit, CreditLimitError } from "@/lib/credits";

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

  const { team } = await getOrCreateUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  const url = canonicalizeSiteUrl(parsed.data.url);
  if (!url) {
    return NextResponse.json(
      { error: "Enter a valid URL, e.g. https://example.com" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  let site;
  let scanRow: ScanRowWithMeta;
  try {
    await client.query("begin");

    site = await client.query(
      `insert into sites (team_id, url) values ($1, $2)
       on conflict (team_id, url) do update set url = excluded.url
       returning id, team_id, url`,
      [team.id, url],
    );

    const inserted = await client.query(
      `insert into scans (site_id, status)
       values ($1, 'queued') returning *`,
      [site.rows[0].id],
    );
    scanRow = inserted.rows[0] as ScanRowWithMeta;

    await setSiteScanState(client, site.rows[0].id, {
      scanId: scanRow.id,
      status: "queued",
    });

    await spendCredit(client, {
      teamId: team.id,
      reason: "scan",
      scanId: scanRow.id,
    });

    await client.query("commit");
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // transactie is mogelijk al beëindigd — negeren
    }
    client.release();
    if (err instanceof CreditLimitError) {
      return NextResponse.json(
        {
          error: "Scan-limiet bereikt. Upgrade naar Pro voor meer scans per maand.",
          upsell: { plan: "pro" },
          usage: {
            creditsUsed: err.creditsUsed,
            creditsLimit: err.creditsLimit,
          },
        },
        { status: 402 },
      );
    }
    console.error("onboarding site mislukt", err);
    return NextResponse.json(
      { error: "Opslaan mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
  client.release();

  // Queue-modus (plan 27): de worker-pipeline voert de scan uit; de webapp
  // antwoordt direct 202 en wacht nooit op het resultaat.
  await enqueueScan(scanRow.id);

  return NextResponse.json(
    { site: site.rows[0], scan: scanRow },
    { status: 202 },
  );
}

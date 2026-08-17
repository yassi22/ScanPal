import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildFindingFixPrompt,
  findingsPayloadSchema,
  fixPromptSchema,
  type FixPromptScope,
} from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/scans/[id]/findings/[findingId]/prompt — één copy-paste prompt
 * voor één finding (plan 60). Zelfde authz als de andere scans-routes (scans
 * JOIN sites op team_id); onbekende scan of finding → 404. Retourneert het
 * fixPromptSchema met `findings_covered: 1`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findingId: string }> },
) {
  const auth = await requireTeam(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 429 ? "Te veel verzoeken" : "Unauthorized" },
      {
        status: auth.status,
        headers:
          auth.status === 429
            ? { "Retry-After": String(auth.retryAfter) }
            : undefined,
      },
    );
  }
  const teamId = auth.ctx.teamId;

  const { id, findingId } = await params;

  const result = await pool.query(
    `select s.findings, s.created_at, st.url as site_url, st.label as site_label,
            st.github_repo
     from scans s
     join sites st on st.id = s.site_id
     where s.id = $1 and st.team_id = $2`,
    [id, teamId],
  );
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = findingsPayloadSchema.safeParse(result.rows[0].findings);
  if (!payload.success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const finding = payload.data.items.find((item) => item.id === findingId);
  if (!finding) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = result.rows[0];
  const scope: FixPromptScope = {
    siteUrl: row.site_url,
    siteLabel: row.site_label,
    githubRepo: row.github_repo ?? null,
    scanId: id,
    scanCreatedAt: new Date(row.created_at).toISOString(),
  };

  const prompt = buildFindingFixPrompt(finding, scope);
  const parsed = fixPromptSchema.safeParse({
    prompt,
    findings_covered: 1,
    truncated: false,
  });
  if (!parsed.success) {
    console.error("fix-prompt voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Prompt genereren mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
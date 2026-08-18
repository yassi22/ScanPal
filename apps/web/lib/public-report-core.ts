import "server-only";

import type { Pool } from "pg";
import { brandingSchema, isValidReportToken, type Branding, type ReportData } from "@scanpal/shared";
import { buildReportData } from "./report/data";

export type PublicReport = {
  data: ReportData;
  branding: Branding;
  expires_at: string | null;
};

export async function getPublicReport(
  db: Pool,
  token: string,
): Promise<PublicReport | null> {
  if (!isValidReportToken(token)) return null;
  const result = await db.query(
    `select s.id, s.report_token_expires_at
     from scans s
     where s.report_token = $1
       and (s.report_token_expires_at is null or s.report_token_expires_at > now())`,
    [token],
  );
  if (result.rowCount === 0) return null;

  const scanId = result.rows[0].id as string;
  const team = await db.query<{ team_id: string }>(
    `select st.team_id from scans s join sites st on st.id = s.site_id where s.id = $1`,
    [scanId],
  );
  if (team.rowCount === 0) return null;

  const built = await buildReportData(db, scanId, team.rows[0].team_id);
  if (!built.ok) return null;

  return {
    data: {
      ...built.data,
      findings: built.data.findings.map((finding) => ({
        ...finding,
        evidence: null,
        note: null,
      })),
    },
    branding: built.branding,
    expires_at: result.rows[0].report_token_expires_at
      ? new Date(result.rows[0].report_token_expires_at).toISOString()
      : null,
  };
}

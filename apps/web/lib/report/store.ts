import "server-only";

import type { Pool } from "pg";
import {
  encodeReportCursor,
  type ReportFormat,
  type ReportMeta,
} from "@scanpal/shared";

export type StoredReport = {
  format: ReportFormat;
  filename: string;
  content: Buffer;
};

function toMeta(row: {
  id: string;
  site_id: string;
  scan_id: string;
  format: ReportFormat;
  filename: string;
  size_bytes: number;
  created_at: Date;
}): ReportMeta {
  return {
    id: row.id,
    site_id: row.site_id,
    scan_id: row.scan_id,
    format: row.format,
    filename: row.filename,
    size_bytes: row.size_bytes,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** Slaat elke download op als een nieuwe historie-rij (besluit 5) — geen dedup. */
export async function saveReport(
  db: Pool,
  input: {
    teamId: string;
    siteId: string;
    scanId: string;
    format: ReportFormat;
    filename: string;
    content: Buffer;
  },
): Promise<ReportMeta> {
  const result = await db.query(
    `insert into reports (team_id, site_id, scan_id, format, filename, content, size_bytes)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, site_id, scan_id, format, filename, size_bytes, created_at`,
    [
      input.teamId,
      input.siteId,
      input.scanId,
      input.format,
      input.filename,
      input.content,
      input.content.length,
    ],
  );
  return toMeta(result.rows[0]);
}

const DEFAULT_PAGE_SIZE = 100;

/**
 * Team-scoped historie, keyset-gepagineerd op `(created_at desc, id desc)`. Een
 * `cursor` (de laatste rij van de vorige pagina) levert de volgende, strikt
 * oudere pagina; zonder cursor de nieuwste pagina. Haalt `limit + 1` rijen om
 * een `next_cursor` te bepalen voor de volgende pagina (null op de laatste).
 */
export async function listReports(
  db: Pool,
  input: {
    teamId: string;
    siteId?: string;
    cursor?: { created_at: string; id: string } | null;
    limit?: number;
  },
): Promise<{ reports: ReportMeta[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
  const params: unknown[] = [input.teamId];
  let siteFilter = "";
  let cursorFilter = "";
  let paramIndex = 2;

  if (input.siteId) {
    params.push(input.siteId);
    siteFilter = `and r.site_id = $${paramIndex}`;
    paramIndex += 1;
  }
  if (input.cursor) {
    params.push(input.cursor.created_at, input.cursor.id);
    cursorFilter = `and (r.created_at, r.id) < ($${paramIndex}, $${paramIndex + 1})`;
    paramIndex += 2;
  }

  params.push(limit + 1);

  const result = await db.query(
    `select r.id, r.site_id, r.scan_id, r.format, r.filename, r.size_bytes, r.created_at
     from reports r
     join sites s on s.id = r.site_id
     where s.team_id = $1 ${siteFilter} ${cursorFilter}
     order by r.created_at desc, r.id desc
     limit $${paramIndex}`,
    params,
  );

  const rows = result.rows as Parameters<typeof toMeta>[0][];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const next_cursor =
    hasMore && last
      ? encodeReportCursor(
          new Date(last.created_at).toISOString(),
          last.id,
        )
      : null;

  return { reports: page.map(toMeta), next_cursor };
}

/** Opgeslagen bytes voor een download — geen regeneratie (besluit 6-route). */
export async function getReportContent(
  db: Pool,
  input: { teamId: string; reportId: string },
): Promise<StoredReport | null> {
  const result = await db.query(
    `select r.format, r.filename, r.content
     from reports r
     join sites s on s.id = r.site_id
     where r.id = $1 and s.team_id = $2`,
    [input.reportId, input.teamId],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { format: row.format, filename: row.filename, content: row.content };
}
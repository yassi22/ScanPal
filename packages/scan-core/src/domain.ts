import type { Pool } from "pg";
import {
  diffDomainMeasurement,
  domainAlerts,
  type DomainAlert,
  type DomainDiff,
  type DomainEventField,
  type DomainMeasurement,
  type DomainStatus,
} from "@scanpal/shared";

/**
 * Domain Watchtower — DB-persistentie (plan 56, stap 1/3). Woont in scan-core
 * (de DB-owning gedeelde laag) zodat zowel de http-worker (catalog-check) als de
 * scheduler (dagelijkse watch) dezelfde schrijflogica gebruiken → scan en watch
 * leveren dezelfde domein-status (plan 56, acceptatiecriteria).
 */

const DOMAIN_CHECK_INTERVAL_DAYS = 1;

async function readPrevStatus(
  db: Pool,
  siteId: string,
): Promise<Partial<DomainMeasurement>> {
  const row = await db.query<{
    domain_expiry: Date | null;
    domain_registrar: string | null;
    dnssec_enabled: boolean | null;
    caa_present: boolean | null;
    tls_expiry: Date | null;
  }>(
    `select domain_expiry, domain_registrar, dnssec_enabled, caa_present, tls_expiry
       from sites where id = $1`,
    [siteId],
  );
  const r = row.rows[0] ?? {};
  const nameservers = await readLastEventValue(db, siteId, "nameservers");
  const caa_records = await readLastEventValue(db, siteId, "caa_records");
  return {
    domain_expiry: r.domain_expiry ? r.domain_expiry.toISOString() : null,
    domain_registrar: r.domain_registrar ?? null,
    dnssec_enabled: r.dnssec_enabled ?? null,
    caa_present: r.caa_present ?? null,
    tls_expiry: r.tls_expiry ? r.tls_expiry.toISOString() : null,
    nameservers: nameservers ? nameservers.split(",") : null,
    caa_records: caa_records ? caa_records.split(",") : null,
  };
}

async function readLastEventValue(
  db: Pool,
  siteId: string,
  field: DomainEventField,
): Promise<string | null> {
  const result = await db.query<{ new_value: string | null }>(
    `select new_value from domain_events
       where site_id = $1 and field = $2 and new_value is not null
       order by checked_at desc
       limit 1`,
    [siteId, field],
  );
  return result.rows[0]?.new_value ?? null;
}

export type ApplyResult = {
  diffs: DomainDiff[];
  alerts: DomainAlert[];
};

/**
 * Persisteert een domein-meting: leest de vorige status (incl. laatste
 * nameservers/CAA uit `domain_events`), diff't, werkt de denormaliseerde
 * `sites`-kolommen bij en schrijft alleen bij verandering een `domain_events`-
 * rij (plan 56, besluit 3). Schuift `next_domain_check_at` op met 1 dag.
 * Retourneert diffs + alerts zodat de scheduler de notificatiehub kan aanroepen
 * (alleen bij verandering, plan 56, besluit 4).
 */
export async function applyDomainMeasurement(
  db: Pool,
  input: { siteId: string; measurement: DomainMeasurement; now?: Date },
): Promise<ApplyResult> {
  const now = input.now ?? new Date();
  const prev = await readPrevStatus(db, input.siteId);
  const diffs = diffDomainMeasurement(prev, input.measurement);
  const alerts = domainAlerts(diffs, input.measurement, now);

  const m = input.measurement;
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `update sites
         set domain_expiry = $2::timestamptz,
             domain_registrar = $3,
             dnssec_enabled = $4,
             caa_present = $5,
             tls_expiry = $6::timestamptz,
             domain_last_checked_at = now(),
             next_domain_check_at = now() + interval '${DOMAIN_CHECK_INTERVAL_DAYS} days'
       where id = $1`,
      [
        input.siteId,
        m.domain_expiry,
        m.domain_registrar,
        m.dnssec_enabled,
        m.caa_present,
        m.tls_expiry,
      ],
    );

    for (const diff of diffs) {
      const newValue = serializeEventValue(diff.field, diff.new_value, m);
      await client.query(
        `insert into domain_events (site_id, field, old_value, new_value, checked_at)
         values ($1, $2, $3, $4, now())`,
        [input.siteId, diff.field, diff.old_value, newValue],
      );
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { diffs, alerts };
}

function serializeEventValue(
  field: DomainEventField,
  fallback: string | null,
  measurement: DomainMeasurement,
): string | null {
  if (field === "nameservers") {
    const ns = measurement.nameservers;
    return ns && ns.length > 0 ? [...ns].sort().join(",") : null;
  }
  if (field === "caa_records") {
    const caa = measurement.caa_records;
    return caa && caa.length > 0 ? [...caa].sort().join(",") : null;
  }
  return fallback;
}

/**
 * Leest de huidige domein-status voor de API/UI: de denormaliseerde `sites`-
 * kolommen + de laatste nameservers/CAA uit `domain_events`.
 */
export async function getDomainStatus(
  db: Pool,
  siteId: string,
): Promise<DomainStatus | null> {
  const row = await db.query<{
    domain_expiry: Date | null;
    domain_registrar: string | null;
    dnssec_enabled: boolean | null;
    caa_present: boolean | null;
    tls_expiry: Date | null;
    domain_last_checked_at: Date | null;
  }>(
    `select domain_expiry, domain_registrar, dnssec_enabled, caa_present,
            tls_expiry, domain_last_checked_at
       from sites where id = $1`,
    [siteId],
  );
  const r = row.rows[0];
  if (!r) return null;

  const nameservers = await readLastEventValue(db, siteId, "nameservers");
  return {
    site_id: siteId,
    domain_expiry: r.domain_expiry ? r.domain_expiry.toISOString() : null,
    domain_registrar: r.domain_registrar,
    dnssec_enabled: r.dnssec_enabled,
    caa_present: r.caa_present,
    tls_expiry: r.tls_expiry ? r.tls_expiry.toISOString() : null,
    nameservers: nameservers ? nameservers.split(",").filter(Boolean) : null,
    last_checked_at: r.domain_last_checked_at
      ? r.domain_last_checked_at.toISOString()
      : null,
  };
}

export type DomainEventRow = {
  id: string;
  site_id: string;
  field: DomainEventField;
  old_value: string | null;
  new_value: string | null;
  checked_at: string;
};

export async function listDomainEvents(
  db: Pool,
  siteId: string,
  limit = 30,
): Promise<DomainEventRow[]> {
  const result = await db.query(
    `select id, site_id, field, old_value, new_value,
            checked_at::timestamptz as checked_at
       from domain_events
      where site_id = $1
      order by checked_at desc
      limit $2`,
    [siteId, limit],
  );
  return result.rows as DomainEventRow[];
}

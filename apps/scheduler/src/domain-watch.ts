import type { Pool } from "pg";
import {
  applyDomainMeasurement,
  measureDomain,
  type DomainDeps,
  type MeasureResult,
} from "@scanpal/scan-core";
import type { DomainAlert, DomainMeasurement } from "@scanpal/shared";

export type DomainDueSite = {
  id: string;
  team_id: string;
  url: string;
  label: string | null;
};

export type DomainNotifier = (input: {
  teamId: string;
  siteId: string;
  siteName: string;
  alert: DomainAlert;
  checkedAt: Date;
}) => Promise<unknown> | unknown;

export type DomainProcessResult = {
  due: number;
  measured: number;
  alerted: number;
};

/**
 * Dagelijkse Domain Watch (plan 56, stap 3). Draait in de bestaande scheduler-
 * poll (60s) — geen nieuwe queue, geen apart proces (plan 56, besluit 1). Haalt
 * sites op waarvan `next_domain_check_at <= now()`, meet (zelfde `measureDomain`
 * als de catalog-check), persisteert via `applyDomainMeasurement` (diff + events
 * + sites-kolommen) en vuurt per alert één `domain_alert`-notificatie (alleen bij
 * verandering, plan 56, besluit 4). `measure`/`apply` zijn injecteerbaar voor
 * tests.
 */
export async function processDueDomainChecks(
  db: Pool,
  input: {
    now?: Date;
    notify: DomainNotifier;
    measure?: (host: string, deps?: DomainDeps) => Promise<MeasureResult>;
    apply?: (
      db: Pool,
      input: { siteId: string; measurement: DomainMeasurement; now?: Date },
    ) => Promise<{ diffs: unknown[]; alerts: DomainAlert[] }>;
    deps?: DomainDeps;
  },
): Promise<DomainProcessResult> {
  const now = input.now ?? new Date();
  const measure = input.measure ?? measureDomain;
  const apply = input.apply ?? applyDomainMeasurement;

  const result: DomainProcessResult = { due: 0, measured: 0, alerted: 0 };

  const due = await db.query<DomainDueSite>(
    `select id, team_id, url, label
       from sites
      where next_domain_check_at is not null
        and next_domain_check_at <= now()
      order by next_domain_check_at
      limit 50`,
  );
  const sites = due.rows;
  result.due = sites.length;

  for (const site of sites) {
    const host = safeHost(site.url);
    if (!host) continue;

    let measured: MeasureResult;
    try {
      measured = await measure(host, input.deps);
    } catch {
      // Een falende meting mag de watch niet breken (plan 56, acceptatiecriteria:
      // geen storing bij RDAP-timeouts). De volgende poll probeert opnieuw.
      continue;
    }

    let applied: { diffs: unknown[]; alerts: DomainAlert[] };
    try {
      applied = await apply(db, {
        siteId: site.id,
        measurement: measured.measurement,
        now,
      });
    } catch {
      continue;
    }

    result.measured += 1;
    const siteName = site.label ?? site.url;
    for (const alert of applied.alerts) {
      try {
        await input.notify({
          teamId: site.team_id,
          siteId: site.id,
          siteName,
          alert,
          checkedAt: now,
        });
      } catch {
        // notificatie-fout mag de watch niet breken
      }
      result.alerted += 1;
    }
  }

  return result;
}

function safeHost(url: string): string | null {
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return host || null;
  } catch {
    return null;
  }
}

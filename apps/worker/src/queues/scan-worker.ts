import type { Pool } from "pg";
import {
  findingId,
  inlineChecksToFindings,
  PER_ROUTE_IMPL_IDS,
  severityRank,
  type Finding,
  type FindingSeverity,
  type InlineCheckLike,
  type ScanRoute,
} from "@scanpal/shared";
import {
  advanceCategoryProgress,
  getScanRoutes,
  setRouteHttpStatus,
} from "@scanpal/scan-core";
import type { RateLimiter } from "../rate-limit";
import type { ImplementedCheck } from "../checks/registry";
import type { CheckContext } from "../checks/types";
import { fetchPage } from "../checks/types";
import type { ScanJobData } from "./index";

type ScanRow = {
  id: string;
  status: string;
  site_url: string;
  active_tests: boolean;
  github_repo: string | null;
};

async function loadScan(db: Pool, scanId: string): Promise<ScanRow | null> {
  const result = await db.query<ScanRow>(
    `select sc.id, sc.status, s.url as site_url, sc.active_tests, s.github_repo
     from scans sc
     join sites s on s.id = sc.site_id
     where sc.id = $1`,
    [scanId],
  );
  return result.rowCount ? result.rows[0] : null;
}

function errorFinding(
  check: ImplementedCheck,
  routeUrl: string | null,
  message: string,
  now: string,
): Finding {
  const idScope = routeUrl ? `${check.id}@${routeUrl}` : check.id;
  return {
    id: findingId(idScope, `${check.id} kon niet worden uitgevoerd`),
    check_id: check.id,
    category: check.category,
    severity: "medium",
    title: `${check.id} kon niet worden uitgevoerd`,
    description: message,
    remediation: "Probeer de scan opnieuw.",
    evidence: null,
    active: false,
    status: "open",
    note: null,
    regressed: false,
    snooze_until: null,
    route_url: routeUrl,
    created_at: now,
  };
}

/**
 * Probeert de HTTP-status van een route (besluit 2: `scan_routes.http_status`).
 * Eén lichte GET per route; faalt het, dan blijft de status NULL. De checks
 * zelf fetchen opnieuw (hun eigen politeness) — het delen van één fetch over
 * meerdere checks is een latere optimalisatie (open vraag scan-tijd).
 */
async function probeRouteStatus(url: string): Promise<number | null> {
  try {
    const res = await fetchPage(url, { timeoutMs: 10_000 });
    return res.status;
  } catch {
    return null;
  }
}

function statusFromSeverity(severity: FindingSeverity): string {
  if (severityRank[severity] >= severityRank.high) return "fail";
  if (severity === "info") return "pass";
  return "warn";
}

/**
 * Idempotente upsert op `(scan_id, check_id, route_url)`. Per-route findings
 * (plan 54) krijgen een niet-NULL `route_url`; site-level checks (github, hier
 * niet gebruikt) krijgen NULL en vallen onder de NULL-partial-index.
 */
async function upsertCheck(
  db: Pool,
  input: {
    scanId: string;
    checkId: string;
    category: string;
    status: string;
    severity: string | null;
    finding: Finding;
    routeUrl: string | null;
  },
): Promise<void> {
  const conflictTarget =
    input.routeUrl !== null
      ? "on conflict (scan_id, check_id, route_url) where route_url is not null"
      : "on conflict (scan_id, check_id) where route_url is null";
  await db.query(
    `insert into checks (scan_id, check_id, category, status, severity, finding, route_url, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     ${conflictTarget}
     do update set
       status = excluded.status,
       severity = excluded.severity,
       finding = excluded.finding,
       route_url = excluded.route_url,
       completed_at = now()`,
    [
      input.scanId,
      input.checkId,
      input.category,
      input.status,
      input.severity,
      JSON.stringify(input.finding),
      input.routeUrl,
    ],
  );
}

/**
 * Generieke sub-job-consumer (plan 27, stap 6; plan 54 route-bewust): laadt de
 * door de crawler ontdekte routes en draait elke check op zijn route-set —
 * per-route impls (security-headers, cookies, cors, meta-tags) op élke route,
 * de overige impls (reachability, https, secrets-in-bundles, active-tests) op
 * de homepage/seed. Findings dragen `route_url`; progress schuift één keer op
 * per catalog-check_id (onafhankelijk van het aantal routes). Jobs idempotent
 * (jobId = `{scanId}:{queue}`); een re-run overschrijft dezelfde rijen.
 */
export function createScanProcessor(
  db: Pool,
  impls: ImplementedCheck[],
  rateLimit: RateLimiter,
) {
  return async function processScanJob(job: { data: ScanJobData }): Promise<void> {
    const { scanId } = job.data;
    const scan = await loadScan(db, scanId);
    if (!scan) return;
    if (scan.status === "canceled") return;

    const homepageUrl = `https://${scan.site_url}`;
    const discovered = await getScanRoutes(db, scanId);
    const routes: ScanRoute[] =
      discovered.length > 0
        ? discovered
        : [{ url: homepageUrl, source: "seed", http_status: null }];

    for (const impl of impls) {
      if (impl.id === "active-tests" && !scan.active_tests) continue;

      const isPerRoute = PER_ROUTE_IMPL_IDS.has(impl.id);
      const targetRoutes = isPerRoute ? routes : routes.slice(0, 1);

      const findingsByCheckId = new Map<string, Finding[]>();
      const probedRoutes = new Set<string>();

      for (const route of targetRoutes) {
        if (!probedRoutes.has(route.url)) {
          probedRoutes.add(route.url);
          const status = await probeRouteStatus(route.url);
          if (status !== null) {
            await setRouteHttpStatus(db, scanId, route.url, status);
          }
        }

        const ctx: CheckContext = {
          url: route.url,
          scanId,
          activeTests: scan.active_tests,
          rateLimit,
          githubRepo: scan.github_repo,
        };
        const now = new Date().toISOString();
        // Github-checks zijn site-level (AGENTS.md): findings krijgen geen
        // route_url (null → aparte NULL-partial-index in de checks-tabel).
        const routeUrlForFindings = impl.category === "github" ? null : route.url;

        let results: InlineCheckLike[];
        try {
          results = await impl.run(ctx);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Onbekende fout";
          const finding = errorFinding(impl, routeUrlForFindings, message, now);
          const list = findingsByCheckId.get(impl.id) ?? [];
          list.push(finding);
          findingsByCheckId.set(impl.id, list);
          continue;
        }

        const routeFindings = inlineChecksToFindings(results, now, routeUrlForFindings);
        for (const finding of routeFindings) {
          const list = findingsByCheckId.get(finding.check_id) ?? [];
          list.push(finding);
          findingsByCheckId.set(finding.check_id, list);
        }
      }

      // Eén checks-rij per (check_id, route_url); progress één keer per check_id
      for (const checkId of impl.outputCheckIds) {
        const findings = findingsByCheckId.get(checkId) ?? [];
        for (const finding of findings) {
          await upsertCheck(db, {
            scanId,
            checkId,
            category: finding.category,
            status: statusFromSeverity(finding.severity),
            severity: finding.severity,
            finding,
            routeUrl: finding.route_url,
          });
        }
        await advanceCategoryProgress(db, scanId, impl.category, checkId, new Date().toISOString());
      }
    }
  };
}
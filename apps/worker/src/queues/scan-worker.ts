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
  setRouteHttpStatuses,
  upsertChecks,
  type ScanCheckRow,
} from "@scanpal/scan-core";
import type { RateLimiter } from "../rate-limit";
import type { ImplementedCheck } from "../checks/registry";
import type { CheckContext, PageFetcher } from "../checks/types";
import { fetchPage } from "../checks/types";
import { mapWithConcurrency } from "../concurrency";
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

function statusFromSeverity(severity: FindingSeverity): string {
  if (severityRank[severity] >= severityRank.high) return "fail";
  if (severity === "info") return "pass";
  return "warn";
}

function pushFinding(map: Map<string, Finding[]>, key: string, finding: Finding): void {
  const list = map.get(key) ?? [];
  list.push(finding);
  map.set(key, list);
}

type RouteScan = {
  db: Pool;
  scanId: string;
  githubRepo: string | null;
  activeTests: boolean;
  rateLimit: RateLimiter;
};

/**
 * Verwerkt één route: haalt de pagina precies één keer op (gedeelde GET) en
 * draait `impls` erop, waarbij elke check die de pagina opnieuw wil ophalen de
 * al opgehaalde response als kloon terugkrijgt via `ctx.fetchPage`. Alleen
 * gewone GET's van de route-URL worden gedeeld; afwijkende requests (CORS met
 * Origin-header, byte-gecapte bundles) fetchen zelf. Retourneert de findings
 * gegroepeerd per check_id (error-findings onder `impl.id`, zoals de oude loop)
 * plus de gevonden http-status (gebundeld weggeschreven door de aanroeper).
 */
type RouteResult = {
  findings: Map<string, Finding[]>;
  status: { url: string; status: number } | null;
};

async function runRoute(
  ctxBase: RouteScan,
  route: ScanRoute,
  impls: ImplementedCheck[],
): Promise<RouteResult> {
  const findingsByCheckId = new Map<string, Finding[]>();

  // Gedeelde fetch: één keer ophalen, status onthouden, en delen via .clone()
  // (behoudt headers incl. meerdere set-cookie exact).
  let shared: Response | null = null;
  try {
    shared = await fetchPage(route.url, { timeoutMs: 10_000 });
  } catch {
    shared = null;
  }
  const status = shared ? { url: route.url, status: shared.status } : null;

  const sharedFetch: PageFetcher = (url, options) => {
    const plainGet = !options?.headers && !options?.maxBytes;
    if (shared && plainGet && url === route.url) {
      return Promise.resolve(shared.clone());
    }
    return fetchPage(url, options);
  };

  for (const impl of impls) {
    const ctx: CheckContext = {
      url: route.url,
      scanId: ctxBase.scanId,
      activeTests: ctxBase.activeTests,
      rateLimit: ctxBase.rateLimit,
      githubRepo: ctxBase.githubRepo,
      fetchPage: sharedFetch,
    };
    const now = new Date().toISOString();
    // Github-checks zijn site-level (AGENTS.md): findings krijgen geen
    // route_url (null → aparte NULL-partial-index in de checks-tabel).
    const routeUrlForFindings = impl.category === "github" || impl.siteLevel ? null : route.url;

    let results: InlineCheckLike[];
    try {
      results = await impl.run(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      pushFinding(findingsByCheckId, impl.id, errorFinding(impl, routeUrlForFindings, message, now));
      continue;
    }

    for (const finding of inlineChecksToFindings(results, now, routeUrlForFindings)) {
      pushFinding(findingsByCheckId, finding.check_id, finding);
    }
  }

  return { findings: findingsByCheckId, status };
}

/**
 * Generieke sub-job-consumer (plan 27, stap 6; plan 54 route-bewust): laadt de
 * door de crawler ontdekte routes en draait elke check op zijn route-set —
 * per-route impls (security-headers, cookies, cors, meta-tags) op élke route,
 * de overige impls (reachability, https, secrets-in-bundles, active-tests) op
 * de homepage/seed. De routes worden route-voor-route verwerkt (één gedeelde
 * fetch per route i.p.v. per check), met hoogstens `routeConcurrency` routes
 * tegelijk. Findings dragen `route_url`; progress schuift één keer op per
 * catalog-check_id (onafhankelijk van het aantal routes). Jobs idempotent
 * (jobId = `{scanId}:{queue}`); een re-run overschrijft dezelfde rijen.
 */
export function createScanProcessor(
  db: Pool,
  impls: ImplementedCheck[],
  rateLimit: RateLimiter,
  options: { routeConcurrency?: number } = {},
) {
  const routeConcurrency = options.routeConcurrency ?? 1;

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

    const activeImpls = impls.filter(
      (impl) => !(impl.id === "active-tests" && !scan.active_tests),
    );
    const perRouteImpls = activeImpls.filter((impl) => PER_ROUTE_IMPL_IDS.has(impl.id));

    // Homepage/seed (index 0) krijgt álle impls; extra routes alleen de
    // per-route impls. Zijn er geen per-route impls, dan blijft het bij de seed.
    const routesToProcess = perRouteImpls.length > 0 ? routes : routes.slice(0, 1);
    const ctxBase: RouteScan = {
      db,
      scanId,
      githubRepo: scan.github_repo,
      activeTests: scan.active_tests,
      rateLimit,
    };

    const perRouteResults = await mapWithConcurrency(
      routesToProcess,
      routeConcurrency,
      (route, index) =>
        runRoute(ctxBase, route, index === 0 ? activeImpls : perRouteImpls),
    );

    // Route-statussen gebundeld wegschrijven (één update i.p.v. één per route).
    const statuses = perRouteResults
      .map((r) => r.status)
      .filter((s): s is { url: string; status: number } => s !== null);
    await setRouteHttpStatuses(db, scanId, statuses);

    // Merge de per-route findings per check_id.
    const findingsByCheckId = new Map<string, Finding[]>();
    for (const { findings } of perRouteResults) {
      for (const [checkId, list] of findings) {
        const merged = findingsByCheckId.get(checkId) ?? [];
        merged.push(...list);
        findingsByCheckId.set(checkId, merged);
      }
    }

    // Per (impl, check_id): de findings gebundeld upserten (één insert met alle
    // route-rijen) + progress één keer opschuiven (blijft per check_id voor de
    // live-voortgang, onafhankelijk van het aantal routes).
    for (const impl of activeImpls) {
      for (const checkId of impl.outputCheckIds) {
        const findings = findingsByCheckId.get(checkId) ?? [];
        const rows: ScanCheckRow[] = findings.map((finding) => ({
          scanId,
          checkId,
          category: finding.category,
          status: statusFromSeverity(finding.severity),
          severity: finding.severity,
          finding,
          routeUrl: finding.route_url,
        }));
        await upsertChecks(db, rows);
        await advanceCategoryProgress(db, scanId, impl.category, checkId, new Date().toISOString());
      }
    }
  };
}

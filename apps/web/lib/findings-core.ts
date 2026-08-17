import "server-only";

import {
  evidenceText,
  findingsPayloadSchema,
  severityRank,
  type BundleSecretEvidence,
  type Finding,
  type FindingsQuery,
  type ScanCategory,
  type SeverityCounts,
} from "@scanpal/shared";

export type FindingsPage = {
  findings: Finding[];
  total: number;
  counts: SeverityCounts;
  categories: ScanCategory[];
  /** Plan 53: beschikbare bundel-secret key_types (voor de filter-dropdown). */
  key_types: string[];
  /** Plan 54: beschikbare routes (voor de route-filter-dropdown). */
  routes: string[];
};

export function emptyFindingsPage(): FindingsPage {
  return {
    findings: [],
    total: 0,
    counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    categories: [],
    key_types: [],
    routes: [],
  };
}

function bundleEvidenceOf(
  evidence: Finding["evidence"],
): BundleSecretEvidence | null {
  if (!evidence || typeof evidence === "string") return null;
  if ("matches" in evidence && evidence.kind === "bundle-secrets") {
    return evidence;
  }
  return null;
}

/** Verzamelt alle key_types uit bundel-evidence in de payload. */
function collectKeyTypes(items: Finding[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const evidence = bundleEvidenceOf(item.evidence);
    if (!evidence) continue;
    for (const match of evidence.matches) set.add(match.key_type);
  }
  return [...set];
}

function matchesKeyType(finding: Finding, keyType: string): boolean {
  const evidence = bundleEvidenceOf(finding.evidence);
  if (!evidence) return false;
  return evidence.matches.some((match) => match.key_type === keyType);
}

/** Plan 54: verzamelt alle niet-NULL route_url's uit de payload (filter-dropdown). */
function collectRouteUrls(items: Finding[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.route_url) set.add(item.route_url);
  }
  return [...set];
}

function matchesText(finding: Finding, needle: string): boolean {
  const haystack = [
    finding.title,
    finding.description,
    evidenceText(finding.evidence),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Server-side filtering/sortering van een findings-payload (plan 09): legacy
 * en niet-v1-payloads leveren een lege pagina op (geen compat-mapping).
 * `counts` telt per severity over status/q/categorie — onafhankelijk van
 * limit/offset en van de severity-filter zelf (voor de filter-chips).
 */
export function queryFindings(
  payload: unknown,
  query: FindingsQuery,
): FindingsPage {
  const parsed = findingsPayloadSchema.safeParse(payload);
  if (!parsed.success) return emptyFindingsPage();

  const items = parsed.data.items;
  if (items.length === 0) return emptyFindingsPage();

  const categories = [...new Set(items.map((item) => item.category))];
  const keyTypes = collectKeyTypes(items);
  const routes = collectRouteUrls(items);

  const needle = query.q?.trim().toLowerCase() ?? "";
  const filtered = items.filter((item) => {
    if (query.severity && item.severity !== query.severity) return false;
    if (query.category && item.category !== query.category) return false;
    if (query.status && item.status !== query.status) return false;
    if (query.active !== undefined && item.active !== query.active) return false;
    if (query.key_type && !matchesKeyType(item, query.key_type)) return false;
    if (query.route_url && item.route_url !== query.route_url) return false;
    if (needle && !matchesText(item, needle)) return false;
    return true;
  });

  const countPool = items.filter((item) => {
    if (query.category && item.category !== query.category) return false;
    if (query.status && item.status !== query.status) return false;
    if (query.active !== undefined && item.active !== query.active) return false;
    if (query.key_type && !matchesKeyType(item, query.key_type)) return false;
    if (query.route_url && item.route_url !== query.route_url) return false;
    if (needle && !matchesText(item, needle)) return false;
    return true;
  });
  const counts: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const item of countPool) counts[item.severity] += 1;

  const direction = query.order === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    switch (query.sort) {
      case "title":
        return a.title.localeCompare(b.title) * direction;
      case "created_at":
        return a.created_at.localeCompare(b.created_at) * direction;
      default:
        return (severityRank[a.severity] - severityRank[b.severity]) * direction;
    }
  });

  return {
    findings: sorted.slice(query.offset, query.offset + query.limit),
    total: sorted.length,
    counts,
    categories,
    key_types: keyTypes,
    routes,
  };
}

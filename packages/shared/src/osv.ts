import { normalizeOsvVulnerability, type OsvVulnerability } from "./sast-findings";

/**
 * Plan 71 — OSV REST-API-client. De osv-scanner-check (feature 48) draait de
 * `osv-scanner` Docker-tool op een gekoppelde repo; voor URL-only sites is er
 * geen repo, dus bevragen we api.osv.dev rechtstreeks met de uit de pagina
 * gedetecteerde (package, version)-paren. Severity-interpretatie is gedeeld
 * met `parseOsvJson` via `normalizeOsvVulnerability` zodat beide bronnen
 * identiek worden genormaliseerd.
 *
 * `packages/shared` blijft dependency-free; de OSV-call gebruikt de runtime-
 * globale `fetch` (geen import). Voor tests kan een `fetchImpl` worden
 * geïnjecteerd.
 */

export const OSV_API_BASE = "https://api.osv.dev/v1";

/**
 * Bovengrens op het aantal unieke vuln-IDs dat per aanroep gehydrateerd wordt
 * (GET /vulns/{id}). Beschermt tegen een enkele stokoude library met tientallen
 * advisories die anders een stortvloed detail-calls naar api.osv.dev triggert.
 * Ruim boven het realistische aantal advisories per gedetecteerde lib.
 */
const MAX_HYDRATED_VULNS = 100;

export type OsvBatchQuery = {
  package: { name: string; ecosystem: string };
  version: string;
};

/** Minimale fetch-abstractie voor de OSV POST/GET (compatibel met globale `fetch`). */
export type OsvFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    /** Alleen aanwezig voor de POST (querybatch); GET /vulns/{id} heeft geen body. */
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/**
 * Bevraag de OSV `querybatch`-endpoint met een lijst (package, version)-paren
 * en hydrateer de resultaten tot volledige vulns.
 *
 * Belangrijk: `querybatch` retourneert per vuln BEWUST alléén `id` + `modified`
 * (geen `severity`/`summary`/`database_specific`). Zonder hydratatie zou elke
 * match op de default-severity ("medium") uitkomen en een kritieke client-side
 * CVE als "warn" i.p.v. "fail" scoren. Daarom:
 *  1) POST /querybatch → per query een lijst vuln-IDs.
 *  2) GET /vulns/{id} voor elk UNIEK id → volledige vuln (severity/summary).
 *  3) IDs terug-mappen naar `normalizeOsvVulnerability` in query-volgorde.
 *
 * Retourneert per query (in dezelfde volgorde) de genormaliseerde vulns — een
 * lege array bij geen kwetsbaarheden of bij een fout. Eén batched call + N
 * detail-calls (beleefd t.o.v. api.osv.dev); de caller zorgt voor rate-limiting.
 * Faalt een detail-call, dan valt die vuln terug op een minimaal record (id
 * only) zodat de finding wél blijft vuren.
 */
export async function queryOsvBatch(
  queries: OsvBatchQuery[],
  options: { fetchImpl?: OsvFetch; signal?: AbortSignal } = {},
): Promise<OsvVulnerability[][]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (queries.length === 0) return [];
  if (typeof fetchImpl !== "function") return queries.map(() => []);

  // Stap 1: batched query → per query een lijst vuln-IDs.
  let res: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await fetchImpl(`${OSV_API_BASE}/querybatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries }),
      signal: options.signal,
    });
  } catch {
    return queries.map(() => []);
  }
  if (!res.ok) return queries.map(() => []);

  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    return queries.map(() => []);
  }
  if (!json || typeof json !== "object") return queries.map(() => []);
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return queries.map(() => []);

  const idsPerQuery: string[][] = queries.map((_q, i) => {
    const entry = results[i];
    if (!entry || typeof entry !== "object") return [];
    const vulns = (entry as { vulns?: unknown }).vulns;
    if (!Array.isArray(vulns)) return [];
    return vulns
      .map((v) =>
        v && typeof v === "object" ? (v as { id?: unknown }).id : undefined,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  });

  // Stap 2: hydrateer unieke IDs via GET /vulns/{id} (severity/summary).
  const uniqueIds = [...new Set(idsPerQuery.flat())].slice(0, MAX_HYDRATED_VULNS);
  const detailById = new Map<string, Record<string, unknown>>();
  await Promise.all(
    uniqueIds.map(async (id) => {
      const detail = await fetchOsvVuln(id, fetchImpl, options.signal);
      if (detail) detailById.set(id, detail);
    }),
  );

  // Stap 3: IDs terug-mappen naar genormaliseerde vulns in query-volgorde. Een
  // id zonder (geslaagde) detail-fetch valt terug op een minimaal record.
  return idsPerQuery.map((ids, i) => {
    const q = queries[i];
    return ids.map((id) =>
      normalizeOsvVulnerability(
        detailById.get(id) ?? { id },
        q.package.name,
        q.package.ecosystem,
        q.version,
      ),
    );
  });
}

/**
 * Haalt één volledig OSV-vuln-record op via `GET /vulns/{id}`. `null` bij een
 * netwerkfout, non-ok status of ongeldige JSON (de caller degradeert dan naar
 * een minimaal record). `id` wordt ge-encodeerd tegen path-injectie.
 */
async function fetchOsvVuln(
  id: string,
  fetchImpl: OsvFetch,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  let res: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await fetchImpl(`${OSV_API_BASE}/vulns/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const json: unknown = JSON.parse(await res.text());
    return json && typeof json === "object"
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

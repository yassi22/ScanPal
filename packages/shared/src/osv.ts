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

export type OsvBatchQuery = {
  package: { name: string; ecosystem: string };
  version: string;
};

/** Minimale fetch-abstractie die volstaat voor de OSV POST (compatibel met globale `fetch`). */
export type OsvFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/**
 * Bevraag de OSV `querybatch`-endpoint met een lijst (package, version)-paren.
 * Retourneert per query (in dezelfde volgorde) de genormaliseerde vulns — een
 * lege array bij geen kwetsbaarheden of bij een fout. Eén batched call per
 * aanroep (beleefd t.o.v. api.osv.dev); de caller zorgt voor rate-limiting.
 */
export async function queryOsvBatch(
  queries: OsvBatchQuery[],
  options: { fetchImpl?: OsvFetch; signal?: AbortSignal } = {},
): Promise<OsvVulnerability[][]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (queries.length === 0) return [];
  if (typeof fetchImpl !== "function") return queries.map(() => []);

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

  return queries.map((q, i) => {
    const entry = results[i];
    if (!entry || typeof entry !== "object") return [];
    const vulns = (entry as { vulns?: unknown }).vulns;
    if (!Array.isArray(vulns)) return [];
    return vulns
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) =>
        normalizeOsvVulnerability(v, q.package.name, q.package.ecosystem, q.version),
      );
  });
}

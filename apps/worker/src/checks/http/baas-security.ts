import {
  BAAS_SECURITY_LIMITS,
  BUNDLE_SCAN_LIMITS,
  buildBaasSecurityEvidence,
  checkById,
  evaluateConvexProbe,
  evaluateFirebaseProbe,
  evaluateSupabaseProbe,
  extractBaasFingerprints,
  extractBundleSecrets,
  extractScriptSrc,
  type BaasFingerprint,
  type BaasPlatform,
  type ConvexProbeResult,
  type FirebaseProbeResult,
  type InlineCheckLike,
  type SupabaseProbeResult,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";
import type { RateLimiter } from "../../rate-limit";

/**
 * Plan 74 — BaaS-security (Supabase / Firebase / Convex). Eén implementatie
 * produceert drie catalog-entries (supabase-security, firebase-security,
 * convex-security). Draait op de seed-route (BaaS-config is site-breed).
 *
 * Twee fases:
 *  1. Fingerprint — regex-extractie van project-URL's + config uit de HTML-body
 *     en JS-bundels die de bestaande fetch al ophaalt (hergebruikt extractScriptSrc
 *     + extractBundleSecrets voor raw anon-keys).
 *  2. Passieve probe — maximaal 1–2 outbound GET's per gevonden project, door
 *     fetchPage (SSRF-guard + byte-cap) + per-host Redis rate-limit. Globaal
 *     budget van 9 GET's; per-platform cap van 3 project-URL's. Bij overschrijding
 *     worden resterende fingerprints als info gerapporteerd (niet geprobed).
 */

const BAAS_CHECK_IDS: BaasPlatform[] = ["supabase", "firebase", "convex"];

const PLATFORM_CHECK_ID: Record<BaasPlatform, string> = {
  supabase: "supabase-security",
  firebase: "firebase-security",
  convex: "convex-security",
};

const MAX_BUNDLES = 10;

export const baasSecurityCheck: CheckImplementation = {
  id: "baas-security",
  category: "http",
  async run(ctx): Promise<InlineCheckLike[]> {
    const fetchImpl = ctx.fetchPage ?? fetchPage;

    // Fase 1: HTML + JS-bundels ophalen (hergebruikt de gememoïseerde fetch).
    let html = "";
    try {
      const page = await fetchImpl(ctx.url, { timeoutMs: 10_000 });
      const contentType = page.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) html = await page.text();
    } catch {
      html = "";
    }

    const bundleTexts = await collectBundleTexts(html, ctx.url, fetchImpl, ctx.rateLimit);
    const fingerprints = extractBaasFingerprints(html, bundleTexts);
    if (fingerprints.length === 0) return [];

    // Raw anon-key voor de Supabase-probe (met key). extractBundleSecrets levert
    // de ongemaskeerde waarde; we gebruiken alleen de eerste supabase-anon-key.
    const combinedText = [html, ...bundleTexts].join("\n");
    const rawAnonKey = extractBundleSecrets(combinedText).find(
      (s) => s.key_type === "supabase_anon_key",
    )?.raw;

    const byPlatform = groupByPlatform(fingerprints);
    const budget = { remaining: BAAS_SECURITY_LIMITS.globalProbeBudget };

    const results: InlineCheckLike[] = [];
    for (const platform of BAAS_CHECK_IDS) {
      const fps = byPlatform.get(platform) ?? [];
      if (fps.length === 0) continue;
      const checkId = PLATFORM_CHECK_ID[platform];
      const name = checkById(checkId)?.name ?? checkId;
      const outcome = await probePlatform(platform, fps, fetchImpl, ctx.rateLimit, budget, rawAnonKey);
      const evaluation =
        platform === "supabase"
          ? evaluateSupabaseProbe(fps[0], outcome.supabase!)
          : platform === "firebase"
            ? evaluateFirebaseProbe(fps[0], outcome.firebase!)
            : evaluateConvexProbe(fps[0], outcome.convex!);
      const evidence = buildBaasSecurityEvidence(
        platform,
        fps,
        outcome.evidenceProbe,
        budget.remaining <= 0 && outcome.hadNotProbed,
      );
      results.push({
        id: checkId,
        name,
        status: evaluation.status,
        detail: evaluation.detail,
        severity: evaluation.severity,
        evidence,
      });
    }
    return results;
  },
};

// --- Bundel-verzameling ----------------------------------------------------

async function collectBundleTexts(
  html: string,
  baseUrl: string,
  fetchImpl: typeof fetchPage,
  rateLimit: RateLimiter,
): Promise<string[]> {
  const scriptUrls = [...new Set(extractScriptSrc(html, baseUrl))].slice(0, MAX_BUNDLES);
  const texts: string[] = [];
  for (const url of scriptUrls) {
    // Per-host rate-limit (zelfde key als secrets-in-bundles, zodat beide checks
    // samen de limiet delen — AGENTS.md: never hammer the target).
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    const rate = await rateLimit(
      `bundle-scan:${host}`,
      BUNDLE_SCAN_LIMITS.downloadsPerHostPerMinute,
    );
    if (!rate.ok) continue;
    try {
      const res = await fetchImpl(url, { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("javascript") || ct.includes("text/") || ct === "") {
        texts.push(await res.text());
      }
    } catch {
      // bundel niet ophaalbaar — overslaan
    }
  }
  return texts;
}

// --- Per-platform probes ---------------------------------------------------

type PlatformOutcome = {
  supabase?: SupabaseProbeResult;
  firebase?: FirebaseProbeResult;
  convex?: ConvexProbeResult;
  evidenceProbe: { performed: boolean; url: string | null; status: number | null; summary: string | null };
  hadNotProbed: boolean;
};

async function probePlatform(
  platform: BaasPlatform,
  fingerprints: BaasFingerprint[],
  fetchImpl: typeof fetchPage,
  rateLimit: RateLimiter,
  budget: { remaining: number },
  rawAnonKey: string | undefined,
): Promise<PlatformOutcome> {
  const capped = fingerprints.slice(0, BAAS_SECURITY_LIMITS.maxProjectsPerPlatform);
  const probedUrls: string[] = [];
  const notProbedUrls: string[] = [];
  let lastProbe = { performed: false, url: null as string | null, status: null as number | null, summary: null as string | null };
  let hadNotProbed = false;

  if (platform === "supabase") {
    let schema_public = false;
    let tables_found: string[] = [];
    let anon_key_used = false;
    for (const fp of capped) {
      if (budget.remaining <= 0) { notProbedUrls.push(fp.projectUrl); hadNotProbed = true; continue; }
      const endpoint = `${fp.projectUrl}/rest/v1/`;
      // Probe 1: geen key.
      const r1 = await safeGet(endpoint, fetchImpl, rateLimit, budget);
      lastProbe = r1.probe;
      if (r1.ok) {
        const tables = parseSupabaseTables(r1.body);
        if (tables.length > 0) {
          schema_public = true;
          tables_found = tables;
          probedUrls.push(fp.projectUrl);
          continue;
        }
      }
      // Probe 2 (alleen bij 401 + beschikbare anon-key): met key.
      if (r1.status === 401 && rawAnonKey && budget.remaining > 0) {
        const r2 = await safeGet(endpoint, fetchImpl, rateLimit, budget, {
          apikey: rawAnonKey,
          Authorization: `Bearer ${rawAnonKey}`,
        });
        lastProbe = r2.probe;
        if (r2.ok) {
          const tables = parseSupabaseTables(r2.body);
          if (tables.length > 0) {
            anon_key_used = true;
            tables_found = tables;
          }
        }
      }
      probedUrls.push(fp.projectUrl);
    }
    for (const fp of fingerprints.slice(capped.length)) notProbedUrls.push(fp.projectUrl);
    return {
      supabase: { schema_public, tables_found, anon_key_used, probed_urls: probedUrls, not_probed_urls: notProbedUrls },
      evidenceProbe: lastProbe,
      hadNotProbed,
    };
  }

  if (platform === "firebase") {
    let rtdb_open = false;
    let storage_open = false;
    let rtdb_shallow_keys: string[] | null = null;
    let storage_items: number | null = null;
    for (const fp of capped) {
      const ref = refOf(fp.projectUrl);
      const isRtdb = fp.projectUrl.includes(".firebaseio.com");
      if (isRtdb) {
        if (budget.remaining <= 0) { notProbedUrls.push(fp.projectUrl); hadNotProbed = true; continue; }
        const url = `https://${ref}.firebaseio.com/.json?shallow=true&limitToFirst=1`;
        const r = await safeGet(url, fetchImpl, rateLimit, budget);
        lastProbe = r.probe;
        if (r.ok) {
          rtdb_open = true;
          rtdb_shallow_keys = parseJsonKeys(r.body);
          probedUrls.push(fp.projectUrl);
        } else {
          probedUrls.push(fp.projectUrl);
        }
      }
      // Storage-probe (als er een storage_bucket in evidence zit, of storage-only fp).
      const hasStorage = fp.evidence["storage_bucket"] || fp.projectUrl.includes(".appspot.com");
      if (hasStorage && budget.remaining > 0) {
        const url = `https://firebasestorage.googleapis.com/v0/b/${ref}.appspot.com/o`;
        const r = await safeGet(url, fetchImpl, rateLimit, budget);
        lastProbe = r.probe;
        if (r.ok) {
          const items = parseStorageItems(r.body);
          if (items !== null) {
            storage_open = true;
            storage_items = items;
          }
        }
        if (!isRtdb) probedUrls.push(fp.projectUrl);
      } else if (!isRtdb) {
        // Storage-only fingerprint met uitgeput budget → niet geprobed.
        notProbedUrls.push(fp.projectUrl);
        hadNotProbed = true;
      }
    }
    for (const fp of fingerprints.slice(capped.length)) notProbedUrls.push(fp.projectUrl);
    return {
      firebase: { rtdb_open, storage_open, rtdb_shallow_keys, storage_items, probed_urls: probedUrls, not_probed_urls: notProbedUrls },
      evidenceProbe: lastProbe,
      hadNotProbed,
    };
  }

  // convex
  let functions_public = false;
  let function_count: number | null = null;
  for (const fp of capped) {
    if (budget.remaining <= 0) { notProbedUrls.push(fp.projectUrl); hadNotProbed = true; continue; }
    const url = `${fp.projectUrl}/api/list_functions`;
    const r = await safeGet(url, fetchImpl, rateLimit, budget);
    lastProbe = r.probe;
    if (r.ok) {
      const count = parseConvexFunctions(r.body);
      if (count !== null) {
        functions_public = true;
        function_count = count;
      }
    }
    probedUrls.push(fp.projectUrl);
  }
  for (const fp of fingerprints.slice(capped.length)) notProbedUrls.push(fp.projectUrl);
  return {
    convex: { functions_public, function_count, probed_urls: probedUrls, not_probed_urls: notProbedUrls },
    evidenceProbe: lastProbe,
    hadNotProbed,
  };
}

function refOf(projectUrl: string): string {
  try {
    const host = new URL(projectUrl).hostname;
    return host.split(".")[0];
  } catch {
    return "";
  }
}

type SafeResult = {
  ok: boolean;
  status: number;
  body: string;
  probe: { performed: boolean; url: string | null; status: number | null; summary: string | null };
};

async function safeGet(
  url: string,
  fetchImpl: typeof fetchPage,
  rateLimit: RateLimiter,
  budget: { remaining: number },
  headers?: Record<string, string>,
): Promise<SafeResult> {
  if (budget.remaining <= 0) {
    return { ok: false, status: 0, body: "", probe: { performed: false, url, status: null, summary: "budget-exhausted" } };
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = url;
  }
  const rate = await rateLimit(
    `baas-probe:${host}`,
    BAAS_SECURITY_LIMITS.probesPerHostPerMinute,
  );
  if (!rate.ok) {
    budget.remaining -= 1;
    return { ok: false, status: 0, body: "", probe: { performed: true, url, status: null, summary: "rate-limited" } };
  }
  budget.remaining -= 1;
  try {
    const res = await fetchImpl(url, {
      timeoutMs: BAAS_SECURITY_LIMITS.probeTimeoutMs,
      maxBytes: 512 * 1024,
      headers,
    });
    const status = res.status;
    const body = res.ok ? await res.text().catch(() => "") : "";
    return {
      ok: res.ok,
      status,
      body,
      probe: { performed: true, url, status, summary: res.ok ? "ok" : `http-${status}` },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch-fout";
    return { ok: false, status: 0, body: "", probe: { performed: true, url, status: null, summary: message } };
  }
}

// --- JSON-parsers ---------------------------------------------------------

function parseJson(body: string): unknown | null {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** PostgREST-root (/rest/v1/) retourneert een OpenAPI-spec; tabellen zitten in
 *  `definitions` (OpenAPI 2.0) of als `paths`-keys (/<table>). */
function parseSupabaseTables(body: string): string[] {
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const defs = obj.definitions;
  if (defs && typeof defs === "object") {
    return Object.keys(defs as Record<string, unknown>);
  }
  const paths = obj.paths;
  if (paths && typeof paths === "object") {
    return Object.keys(paths as Record<string, unknown>)
      .map((p) => p.replace(/^\//, ""))
      .filter((p) => !p.includes("{"));
  }
  return [];
}

function parseJsonKeys(body: string): string[] {
  const parsed = parseJson(body);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return Object.keys(parsed as Record<string, unknown>);
  }
  return [];
}

function parseStorageItems(body: string): number | null {
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== "object") return null;
  const items = (parsed as Record<string, unknown>).items;
  return Array.isArray(items) ? items.length : null;
}

function parseConvexFunctions(body: string): number | null {
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  // Convex list_functions kan een array of {functions: [...]} retourneren.
  if (Array.isArray(obj.functions)) return obj.functions.length;
  if (Array.isArray(obj)) return obj.length;
  return null;
}

// --- Helpers --------------------------------------------------------------

function groupByPlatform(fingerprints: BaasFingerprint[]): Map<BaasPlatform, BaasFingerprint[]> {
  const map = new Map<BaasPlatform, BaasFingerprint[]>();
  for (const fp of fingerprints) {
    const list = map.get(fp.platform) ?? [];
    list.push(fp);
    map.set(fp.platform, list);
  }
  return map;
}

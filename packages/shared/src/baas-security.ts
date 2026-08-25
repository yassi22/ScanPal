import { z } from "zod";
import { decodeBase64Url, maskSecret } from "./bundle-secrets";
import type { FindingSeverity } from "./severity";

/**
 * Plan 74 — BaaS-security (Supabase / Firebase / Convex): passieve black-box
 * detectie van Backend-as-a-Service-misconfiguraties. Deze module is puur
 * functioneel (geen netwerk, geen DB): fingerprint-extractie uit HTML/JS +
 * severity-evaluatie van passieve probe-resultaten. De worker-wrapper
 * (apps/worker) voert de outbound probes uit en voedt de evaluate-helpers.
 */

/** Begrenzingen (besluit 9): per-platform cap + globaal outbound-budget. */
export const BAAS_SECURITY_LIMITS = {
  /** Maximaal aantal project-URL's dat per platform geprobed wordt. */
  maxProjectsPerPlatform: 3,
  /** Globaal probe-budget: maximaal 9 outbound-GETs per scan (3 × 3). */
  globalProbeBudget: 9,
  /** Per-host Redis rate-limit voor BaaS-probes. */
  probesPerHostPerMinute: 5,
  /** Timeout per probe. */
  probeTimeoutMs: 8000,
} as const;

export const baasPlatformSchema = z.enum(["supabase", "firebase", "convex"]);
export type BaasPlatform = z.infer<typeof baasPlatformSchema>;

/** Eén herkend BaaS-project uit HTML/JS (fase 1, geen extra request). */
export const baasFingerprintSchema = z.object({
  platform: baasPlatformSchema,
  /** Publieke project-URL (bijv. https://xyz.supabase.co). */
  projectUrl: z.string(),
  /** Config-snippets + gemaskeerde keys (publieke informatie). */
  evidence: z.record(z.string(), z.string()),
});
export type BaasFingerprint = z.infer<typeof baasFingerprintSchema>;

/** Resultaat van de passieve Supabase-probe (fase 2). */
export const supabaseProbeResultSchema = z.object({
  schema_public: z.boolean(),
  tables_found: z.array(z.string()),
  anon_key_used: z.boolean(),
  probed_urls: z.array(z.string()),
  not_probed_urls: z.array(z.string()),
});
export type SupabaseProbeResult = z.infer<typeof supabaseProbeResultSchema>;

/** Resultaat van de passieve Firebase-probe (fase 2). */
export const firebaseProbeResultSchema = z.object({
  rtdb_open: z.boolean(),
  storage_open: z.boolean(),
  rtdb_shallow_keys: z.array(z.string()).nullable(),
  storage_items: z.number().int().nullable(),
  probed_urls: z.array(z.string()),
  not_probed_urls: z.array(z.string()),
});
export type FirebaseProbeResult = z.infer<typeof firebaseProbeResultSchema>;

/** Resultaat van de passieve Convex-probe (fase 2). */
export const convexProbeResultSchema = z.object({
  functions_public: z.boolean(),
  function_count: z.number().int().nullable(),
  probed_urls: z.array(z.string()),
  not_probed_urls: z.array(z.string()),
});
export type ConvexProbeResult = z.infer<typeof convexProbeResultSchema>;

/** Gestructureerd evidence van de baas-security-check (één per platform). */
export const baasSecurityEvidenceSchema = z.object({
  kind: z.literal("baas-security"),
  platform: baasPlatformSchema,
  fingerprints: z.array(
    z.object({
      project_url: z.string(),
      config_keys: z.array(
        z.object({
          type: z.string(),
          masked: z.string(),
        }),
      ),
    }),
  ),
  probe: z.object({
    performed: z.boolean(),
    url: z.string().nullable(),
    status: z.number().nullable(),
    summary: z.string().nullable(),
  }),
  budget_exhausted: z.boolean(),
});
export type BaasSecurityEvidence = z.infer<typeof baasSecurityEvidenceSchema>;

// --- Fingerprint-extractie -------------------------------------------------

const SUPABASE_URL_RE = /https:\/\/([a-z0-9-]+)\.supabase\.co/gi;
const SUPABASE_CONFIG_URL_RE = /supabaseUrl\s*[:=]\s*["']([^"']+)["']/gi;
const SUPABASE_ANON_RE = /sb_publishable_[A-Za-z0-9_-]{20,}/g;
const SUPABASE_SECRET_RE = /sb_secret_[A-Za-z0-9_-]{20,}/g;
const SUPABASE_JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}/g;

const FIREBASE_DB_URL_RE = /https:\/\/([a-z0-9-]+)\.firebaseio\.com/gi;
const FIREBASE_STORAGE_RE = /([a-z0-9-]+)\.appspot\.com/gi;
const FIREBASE_API_KEY_RE = /\bAIza[0-9A-Za-z_-]{35}\b/g;
const FIREBASE_CONFIG_RE =
  /firebaseConfig\s*=\s*\{([\s\S]*?)\}/gi;

const CONVEX_URL_RE = /https:\/\/([a-z0-9-]+)\.convex\.cloud/gi;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function matchAll(regex: RegExp, text: string): string[] {
  const re = new RegExp(regex.source, regex.flags);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1] ?? m[0]);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

function matchFull(regex: RegExp, text: string): string[] {
  const re = new RegExp(regex.source, regex.flags);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

/** Supabase-JWT-classificatie (hergebruikt decodeBase64Url uit bundle-secrets). */
function isSupabaseServiceRoleJwt(raw: string): boolean {
  try {
    const decoded = decodeBase64Url(raw.split(".")[1] ?? "");
    return decoded.includes("supabase") && decoded.includes("service_role");
  } catch {
    return false;
  }
}

function extractSupabaseFingerprints(text: string): BaasFingerprint[] {
  const refs = unique(matchAll(SUPABASE_URL_RE, text));
  const configUrls = unique(matchAll(SUPABASE_CONFIG_URL_RE, text));
  for (const url of configUrls) {
    const m = /https:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(url);
    if (m && !refs.includes(m[1])) refs.push(m[1]);
  }
  if (refs.length === 0) return [];

  const anonKeys = unique(matchFull(SUPABASE_ANON_RE, text));
  const secretKeys = unique(matchFull(SUPABASE_SECRET_RE, text));
  const jwts = unique(matchFull(SUPABASE_JWT_RE, text));
  const serviceRoleJwts = jwts.filter(isSupabaseServiceRoleJwt);

  return refs.map((ref) => {
    const evidence: Record<string, string> = {
      project_url: `https://${ref}.supabase.co`,
    };
    if (anonKeys.length > 0) evidence.anon_key = maskSecret(anonKeys[0]);
    if (secretKeys.length > 0) evidence.service_role_key = maskSecret(secretKeys[0]);
    if (serviceRoleJwts.length > 0)
      evidence.service_role_jwt = maskSecret(serviceRoleJwts[0]);
    return {
      platform: "supabase",
      projectUrl: `https://${ref}.supabase.co`,
      evidence,
    };
  });
}

function extractFirebaseConfig(text: string): {
  projectIds: string[];
  storageBuckets: string[];
  apiKeys: string[];
} {
  const projectIds: string[] = [];
  const storageBuckets: string[] = [];
  const re = new RegExp(FIREBASE_CONFIG_RE.source, FIREBASE_CONFIG_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1] ?? "";
    const projectId = /projectId\s*:\s*["']([^"']+)["']/i.exec(body)?.[1];
    const storageBucket = /storageBucket\s*:\s*["']([^"']+)["']/i.exec(body)?.[1];
    if (projectId) projectIds.push(projectId);
    if (storageBucket) {
      const bucket = storageBucket.replace(/\.appspot\.com$/i, "");
      storageBuckets.push(bucket);
    }
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  const apiKeys = unique(matchFull(FIREBASE_API_KEY_RE, text));
  return { projectIds: unique(projectIds), storageBuckets: unique(storageBuckets), apiKeys };
}

function extractFirebaseFingerprints(text: string): BaasFingerprint[] {
  const rtdbRefs = unique(matchAll(FIREBASE_DB_URL_RE, text));
  const storageFromUrls = unique(matchAll(FIREBASE_STORAGE_RE, text));
  const { projectIds, storageBuckets, apiKeys } = extractFirebaseConfig(text);
  const storageRefs = unique([...storageFromUrls, ...storageBuckets]);

  // Project-refs = union van RTDB-refs en config-projectIds.
  const refs = unique([...rtdbRefs, ...projectIds]);
  if (refs.length === 0 && storageRefs.length === 0) return [];

  const fingerprints: BaasFingerprint[] = [];
  for (const ref of refs) {
    const evidence: Record<string, string> = {
      project_url: `https://${ref}.firebaseio.com`,
    };
    if (storageRefs.includes(ref)) {
      evidence.storage_bucket = `https://${ref}.appspot.com`;
    }
    if (apiKeys.length > 0) evidence.api_key = maskSecret(apiKeys[0]);
    fingerprints.push({
      platform: "firebase",
      projectUrl: `https://${ref}.firebaseio.com`,
      evidence,
    });
  }
  // Storage-only projecten (geen RTDB-ref): aparte fingerprint voor de bucket.
  for (const bucket of storageRefs) {
    if (refs.includes(bucket)) continue;
    fingerprints.push({
      platform: "firebase",
      projectUrl: `https://${bucket}.appspot.com`,
      evidence: {
        project_url: `https://${bucket}.appspot.com`,
        storage_bucket: `https://${bucket}.appspot.com`,
        ...(apiKeys.length > 0 ? { api_key: maskSecret(apiKeys[0]) } : {}),
      },
    });
  }
  return fingerprints;
}

function extractConvexFingerprints(text: string): BaasFingerprint[] {
  const refs = unique(matchAll(CONVEX_URL_RE, text));
  return refs.map((ref) => ({
    platform: "convex",
    projectUrl: `https://${ref}.convex.cloud`,
    evidence: { project_url: `https://${ref}.convex.cloud` },
  }));
}

/**
 * Extraheert BaaS-fingerprints uit de HTML-body en (inline/externe) scripts.
 * Pure regex-scan; geen netwerk. Combineert alle platformen; de worker groepeert
 * per platform en voert de passieve probes uit.
 */
export function extractBaasFingerprints(
  html: string,
  scripts: string[] = [],
): BaasFingerprint[] {
  const text = [html, ...scripts].join("\n");
  return [
    ...extractSupabaseFingerprints(text),
    ...extractFirebaseFingerprints(text),
    ...extractConvexFingerprints(text),
  ];
}

// --- Evaluatie (severity-mapping, besluit 7) -------------------------------

export type BaasEvaluation = {
  status: "pass" | "fail" | "warn" | "info";
  severity: FindingSeverity;
  detail: string;
};

/**
 * Supabase: PostgREST-schema publiek zonder key → high (tabelnamen lekken).
 * Schema pas met anon-key opvraagbaar → medium (RLS mogelijk ontbrekend).
 * Beschermd → info.
 */
export function evaluateSupabaseProbe(
  fp: BaasFingerprint,
  probe: SupabaseProbeResult,
): BaasEvaluation {
  const urls = [...probe.probed_urls, ...probe.not_probed_urls];
  const urlList = urls.length > 0 ? ` (${urls.join(", ")})` : "";
  if (probe.schema_public) {
    return {
      status: "fail",
      severity: "high",
      detail: `Supabase PostgREST-schema is publiek leesbaar zonder authenticatie — tabelnamen lekken${urlList}. Geobserveerd: ${probe.tables_found.length} tabel(len) via het open schema-endpoint. Advies: schakel RLS in op alle tabellen (RLS kan op tabel-niveau actief zijn terwijl de schema-listing open is — verifieer per tabel).`,
    };
  }
  if (probe.anon_key_used && probe.tables_found.length > 0) {
    return {
      status: "warn",
      severity: "medium",
      detail: `Supabase PostgREST-schema is opvraagbaar met de publieke anon-key — tabelnamen zichtbaar${urlList}. Mogelijk ontbreekt RLS op tabel-niveau. Advies: schakel RLS in en verifieer dat de anon-key geen ongeautoriseerde rijen kan lezen.`,
    };
  }
  if (probe.probed_urls.length > 0) {
    return {
      status: "info",
      severity: "info",
      detail: `Supabase-project gevonden${urlList}; PostgREST-schema is beschermd (geen tabelnamen gelekt).`,
    };
  }
  return {
    status: "info",
    severity: "info",
    detail: `Supabase-project gevonden (${fp.projectUrl}); niet geprobed (budget/cap bereikt).`,
  };
}

/**
 * Firebase: Realtime DB of Storage open voor lezen → high. API-key alleen → info
 * (de Firebase apiKey is ontworpen als publiek; alleen critical in combinatie
 * met een open DB/bucket, gerapporteerd als high).
 */
export function evaluateFirebaseProbe(
  fp: BaasFingerprint,
  probe: FirebaseProbeResult,
): BaasEvaluation {
  const urls = [...probe.probed_urls, ...probe.not_probed_urls];
  const urlList = urls.length > 0 ? ` (${urls.join(", ")})` : "";
  if (probe.rtdb_open) {
    const keys = probe.rtdb_shallow_keys
      ? ` Top-level keys: ${probe.rtdb_shallow_keys.join(", ")}.`
      : "";
    return {
      status: "fail",
      severity: "high",
      detail: `Firebase Realtime Database is leesbaar zonder authenticatie (.json → 200)${urlList}.${keys} Advies: beveilig je database rules.`,
    };
  }
  if (probe.storage_open) {
    const items = probe.storage_items !== null ? ` (${probe.storage_items} item(s))` : "";
    return {
      status: "fail",
      severity: "high",
      detail: `Firebase Cloud Storage-bucket is publiek leesbaar${urlList}${items}. Advies: beperk de storage rules tot geauthenticeerde leestoegang.`,
    };
  }
  if (probe.probed_urls.length > 0) {
    return {
      status: "info",
      severity: "info",
      detail: `Firebase-project gevonden${urlList}; Realtime DB en Storage zijn beschermd. De Firebase API-key is ontworpen als publiek en is op zichzelf geen bevinding.`,
    };
  }
  return {
    status: "info",
    severity: "info",
    detail: `Firebase-project gevonden (${fp.projectUrl}); niet geprobed (budget/cap bereikt).`,
  };
}

/** Convex: functies publiek opvraagbaar → low; anders info. */
export function evaluateConvexProbe(
  fp: BaasFingerprint,
  probe: ConvexProbeResult,
): BaasEvaluation {
  const urls = [...probe.probed_urls, ...probe.not_probed_urls];
  const urlList = urls.length > 0 ? ` (${urls.join(", ")})` : "";
  if (probe.functions_public) {
    const count =
      probe.function_count !== null ? ` (${probe.function_count} functie(s))` : "";
    return {
      status: "warn",
      severity: "low",
      detail: `Convex-deployment gevonden met publiek opvraagbare functies${urlList}${count}. Advies: voeg authenticatie toe aan je Convex-functies.`,
    };
  }
  if (probe.probed_urls.length > 0) {
    return {
      status: "info",
      severity: "info",
      detail: `Convex-deployment gevonden${urlList}; metadata-endpoint beschermd of onbekend.`,
    };
  }
  return {
    status: "info",
    severity: "info",
    detail: `Convex-deployment gevonden (${fp.projectUrl}); niet geprobed (budget/cap bereikt).`,
  };
}

/** Bouwt de evidence-structuur voor één platform-finding. */
export function buildBaasSecurityEvidence(
  platform: BaasPlatform,
  fingerprints: BaasFingerprint[],
  probe: { performed: boolean; url: string | null; status: number | null; summary: string | null },
  budgetExhausted: boolean,
): BaasSecurityEvidence {
  return {
    kind: "baas-security",
    platform,
    fingerprints: fingerprints.map((fp) => ({
      project_url: fp.projectUrl,
      config_keys: Object.entries(fp.evidence)
        .filter(([k]) => k !== "project_url" && k !== "storage_bucket")
        .map(([type, masked]) => ({ type, masked })),
    })),
    probe,
    budget_exhausted: budgetExhausted,
  };
}

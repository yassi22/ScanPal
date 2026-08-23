import { z } from "zod";
import type { OsvSeverity, OsvVulnerability } from "./sast-findings";

/**
 * Plan 71 — client-side dependency-detectie + CVE-evidence. Puur logica: herken
 * JS-libraries + versies uit script-URL's (CDN-patronen) en combineer ze met de
 * OSV-lookup uit `osv.ts`. De worker-check (`client-deps-cve.ts`) haalt de
 * pagina op, voert de script-URL's hier in en emit findings.
 *
 * v1 is statisch (URL-parsing); runtime-globals via Playwright is v2 (plan 71).
 */

/* ---------------------------- detectie ---------------------------- */

const VER = "(\\d+(?:\\.\\d+){1,2}(?:[-+][\\w.-]+)?)";

/** jsDelivr: /npm/<pkg>@<ver>/ — <pkg> mag scoped (@scope/name) of unscoped zijn. */
const JSDELIVR_RE = new RegExp(`/npm/(?:(@[^/]+/[^/]+)|([^/@][^/]*))@${VER}(?:/|$)`);
/** unpkg/generiek: /<pkg>@<ver>/ — scoped of unscoped. */
const UNPKG_RE = new RegExp(`/(?:(@[^/]+/[^/]+)|([^/@][^/]*))@${VER}(?:/|$)`);

/**
 * Klassieke CDN-stijl (zonder @-sigil) voor bekende libs: /<lib>-<ver>.min.js.
 * `react-dom` staat vóór `react` én is een eigen entry: het is een apart
 * npm-package met eigen advisories, dus mag niet als `react` gequeried worden
 * (zou react-dom-CVE's missen en evidence verkeerd labelen). De `react`-regex
 * matcht bewust alleen `/react.<ver>` (niet `/react-dom.<ver>`).
 */
const KNOWN_LIB_CLASSIC: { name: string; re: RegExp }[] = [
  { name: "jquery", re: new RegExp(`/jquery[-.]${VER}\\.min\\.js`, "i") },
  { name: "bootstrap", re: new RegExp(`/bootstrap[.-]${VER}\\.min\\.js`, "i") },
  { name: "vue", re: new RegExp(`/vue\\.${VER}\\.min\\.js`, "i") },
  { name: "react-dom", re: new RegExp(`/react-dom\\.${VER}\\.min\\.js`, "i") },
  { name: "react", re: new RegExp(`/react\\.${VER}\\.min\\.js`, "i") },
  { name: "angular", re: new RegExp(`/angular(?:-min)?\\.${VER}\\.min\\.js`, "i") },
  { name: "lodash", re: new RegExp(`/lodash\\.${VER}\\.min\\.js`, "i") },
  { name: "moment", re: new RegExp(`/moment\\.${VER}\\.min\\.js`, "i") },
];

export const clientDepSourceSchema = z.enum(["cdn-url", "runtime-global"]);
export type ClientDepSource = z.infer<typeof clientDepSourceSchema>;

export const detectedDependencySchema = z.object({
  package: z.string(),
  ecosystem: z.literal("npm"),
  version: z.string(),
  source: clientDepSourceSchema,
  /** Script-URL waaruit de detectie afkomstig is. */
  origin: z.string(),
});
export type DetectedDependency = z.infer<typeof detectedDependencySchema>;

function detectFromUrl(url: string): DetectedDependency | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }

  let m = path.match(JSDELIVR_RE);
  if (m) {
    return dep((m[1] ?? m[2])!, m[3], url);
  }
  m = path.match(UNPKG_RE);
  if (m) {
    return dep((m[1] ?? m[2])!, m[3], url);
  }
  for (const lib of KNOWN_LIB_CLASSIC) {
    const mm = path.match(lib.re);
    if (mm) return dep(lib.name, mm[1], url);
  }
  return null;
}

function dep(pkg: string, version: string, origin: string): DetectedDependency {
  return { package: pkg, ecosystem: "npm", version, source: "cdn-url", origin };
}

/**
 * Herken client-side JS-libraries + versies uit script-URL's. Eén detectie per
 * URL; gedupliceerd op `(package, version)`. Puur en deterministisch — geen
 * netwerk. Onbekende/ongeversioneerde URL's worden overgeslagen (geen
 * info-finding per onbekende lib; de check emit alleen versie-bevestigde deps).
 */
export function detectClientDeps(scriptUrls: string[]): DetectedDependency[] {
  const seen = new Set<string>();
  const out: DetectedDependency[] = [];
  for (const url of scriptUrls) {
    const d = detectFromUrl(url);
    if (!d) continue;
    const key = `${d.package}@${d.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/* ---------------------------- runtime-globals (v2) ---------------------------- */

/**
 * Plan 71 v2 — runtime-detectie via window-globals. De browser-runner leest in
 * één `page.evaluate` een vaste set bekende globals uit en retourneert per lib
 * de versie-string (of `null` als de global afwezig is). Deze helper normaliseert
 * die capture naar `DetectedDependency[]` met `source: "runtime-global"`.
 *
 * Runtime-bewijzen zijn harder dan URL-parsing: een bundel zonder versie in de
 * URL (`/assets/vendor.js`) kan zo toch een kwetsbare React/Vue-versie aan het
 * licht brengen via `window.React.version`.
 */
export const runtimeDepsCaptureSchema = z.object({
  jquery: z.string().nullable().optional(),
  react: z.string().nullable().optional(),
  vue: z.string().nullable().optional(),
  angular: z.string().nullable().optional(),
  lodash: z.string().nullable().optional(),
  moment: z.string().nullable().optional(),
  bootstrap: z.string().nullable().optional(),
});
export type RuntimeDepsCapture = z.infer<typeof runtimeDepsCaptureSchema>;

/** Lib → npm-package + de window-global-expressie (voor evidence/origin). */
const RUNTIME_LIBS: { lib: keyof RuntimeDepsCapture; package: string; global: string }[] = [
  { lib: "jquery", package: "jquery", global: "window.jQuery.fn.jquery" },
  { lib: "react", package: "react", global: "window.React.version" },
  { lib: "vue", package: "vue", global: "window.Vue.version" },
  { lib: "angular", package: "angular", global: "window.angular.version.full" },
  { lib: "lodash", package: "lodash", global: "window._.VERSION" },
  { lib: "moment", package: "moment", global: "window.moment.version" },
  { lib: "bootstrap", package: "bootstrap", global: "window.bootstrap.Tooltip.VERSION" },
];

/**
 * Normaliseert een runtime-globals-capture naar `DetectedDependency[]`. Libs
 * met een niet-lege versie-string worden versie-bevestigd; een global die
 * aanwezig is maar geen versie oplevert, levert geen dep op (geen valse
 * CVE-claim zonder versie). Gedupliceerd op `(package, version)`.
 */
export function detectRuntimeDeps(capture: RuntimeDepsCapture): DetectedDependency[] {
  const seen = new Set<string>();
  const out: DetectedDependency[] = [];
  for (const entry of RUNTIME_LIBS) {
    const version = capture[entry.lib];
    if (typeof version !== "string" || version.trim() === "") continue;
    const key = `${entry.package}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      package: entry.package,
      ecosystem: "npm",
      version,
      source: "runtime-global",
      origin: entry.global,
    });
  }
  return out;
}

/* ---------------------------- evidence ---------------------------- */

const SEVERITY_ORDER: OsvSeverity[] = ["low", "medium", "high", "critical"];

function worstSeverity(sevs: OsvSeverity[]): OsvSeverity {
  if (sevs.length === 0) return "low";
  return sevs.reduce((acc, s) =>
    SEVERITY_ORDER.indexOf(s) > SEVERITY_ORDER.indexOf(acc) ? s : acc,
  );
}

export const clientDepsSampleSchema = z.object({
  package: z.string(),
  version: z.string(),
  /** Worst-case severity van de matches; "info" als de versie onbevestigd is. */
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  vuln_ids: z.array(z.string()),
  source: clientDepSourceSchema,
  origin: z.string(),
});
export type ClientDepsSample = z.infer<typeof clientDepsSampleSchema>;

export const clientDepsEvidenceSchema = z.object({
  kind: z.literal("client-deps"),
  total: z.number().int(),
  vulnerable: z.number().int(),
  unconfirmed: z.number().int(),
  by_severity: z.object({
    critical: z.number().int(),
    high: z.number().int(),
    medium: z.number().int(),
    low: z.number().int(),
  }),
  samples: z.array(clientDepsSampleSchema),
});
export type ClientDepsEvidence = z.infer<typeof clientDepsEvidenceSchema>;

/**
 * Bouwt de evidence voor de client-deps-cve-check. `vulnsByDep` levert per dep
 * (in dezelfde volgorde als `deps`) de OSV-matches; een lege array = geen
 * bekende kwetsbaarheden (of onbevestigde versie → de caller geeft dan `[]`).
 */
export function clientDepsEvidence(
  deps: DetectedDependency[],
  vulnsByDep: OsvVulnerability[][],
): ClientDepsEvidence {
  const by = { critical: 0, high: 0, medium: 0, low: 0 };
  const samples: ClientDepsSample[] = [];
  let vulnerable = 0;

  deps.forEach((d, i) => {
    const vulns = vulnsByDep[i] ?? [];
    if (vulns.length === 0) return;
    vulnerable += 1;
    const sev = worstSeverity(vulns.map((v) => v.severity));
    by[sev] += 1;
    samples.push({
      package: d.package,
      version: d.version,
      severity: sev,
      vuln_ids: vulns.map((v) => v.id).slice(0, 10),
      source: d.source,
      origin: d.origin,
    });
  });

  return {
    kind: "client-deps",
    total: deps.length,
    vulnerable,
    unconfirmed: 0,
    by_severity: by,
    samples: samples.slice(0, 10),
  };
}

/** Status: critical/high → fail, medium/low → warn, anders pass. */
export function clientDepsStatus(vulnerable: number, by: ClientDepsEvidence["by_severity"]): "pass" | "warn" | "fail" {
  if (vulnerable === 0) return "pass";
  if (by.critical > 0 || by.high > 0) return "fail";
  return "warn";
}

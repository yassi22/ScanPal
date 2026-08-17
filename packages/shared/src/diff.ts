import { z } from "zod";
import type { Finding } from "./findings";
import { emptySeverityCounts, findingSchema } from "./findings";
import { severityCountsSchema, type SeverityCounts } from "./scan-progress";
import { severityRank, type FindingSeverity } from "./severity";

/**
 * Diff-gebaseerde monitoring (plan 59): pure logica, geen DB. De worker
 * berekent per voltooide scan de diff t.o.v. de laatste schone snapshot en
 * slaat die op in `scans.diff`; de webapp toont de "Wijzigingen"-view en de
 * notificatiehub consumeert `alert_new`/`alert_regressed`.
 */

/* ── stabiliteit ──────────────────────────────────────────────────────────── */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

function toHex(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/**
 * Dependency-vrije SHA-256 (works in Node én browsers; shared is zod-only en
 * mag geen platform-specifieke imports hebben). Gebruikt als fingerprint-
 * hash — deterministisch en stabiel, niet als beveiligingsprimitive.
 */
export function sha256hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j += 1) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j += 1) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let j = 0; j < 64; j += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[j] + w[j]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map(toHex).join("");
}

/**
 * Stabiele fingerprint van een finding = hash van `check_id + route_url +
 * title` (de "rule"-identiteit, plan 59 besluit 2). Bewust ZONDER het
 * detail/evidence-veld, zodat kleine tekstwijzigingen de identiteit niet
 * veranderen (open vraag → rule-only, geen detail-hash). Severity/status
 * tellen ook niet mee — een warn→fail-overgang is nog steeds dezelfde
 * bevinding.
 */
export function findingFingerprint(
  finding: Pick<Finding, "check_id" | "title" | "route_url">,
): string {
  return sha256hex(`${finding.check_id}\u0000${finding.route_url ?? ""}\u0000${finding.title}`);
}

/* ── snooze (plan 59 besluit 5) ───────────────────────────────────────────── */

/**
 * Snooze-actief-check: `snooze_until`-veld op de finding (schema in
 * `findings.ts`). ISO-datetime in de toekomst of het sentinel `"next-scan"`
 * dempt diff-alerts; de view toont de finding gewoon.
 */
export function isSnoozed(
  finding: Pick<Finding, "snooze_until">,
  now: Date = new Date(),
): boolean {
  const until = finding.snooze_until;
  if (!until) return false;
  if (until === "next-scan") return true;
  return new Date(until).getTime() > now.getTime();
}

/* ── schone snapshot (plan 59 besluit 1) ──────────────────────────────────── */

/**
 * "Schoon" = overall-score ≥ 80 óf geen open critical/high-findings.
 * Actieve-test-findings (plan 52) tellen niet mee (geen onderdeel van de
 * overall-score).
 */
export function isCleanScan(
  score: number | null,
  items: Pick<Finding, "active" | "status" | "severity">[],
): boolean {
  if (score !== null && score >= 80) return true;
  return !items.some(
    (item) =>
      !item.active &&
      item.status === "open" &&
      (item.severity === "critical" || item.severity === "high"),
  );
}

/* ── diff-schema + berekening ─────────────────────────────────────────────── */

export const scanDiffCountsSchema = severityCountsSchema;
export type ScanDiffCounts = SeverityCounts;

/**
 * Diff t.o.v. de laatste schone snapshot, per severity + de geselecteerde
 * finding-id's (plan 59 contract). `alert_new`/`alert_regressed` = dezelfde
 * tellingen maar zonder gesnoozde findings — de notificatiehub consumeert die.
 */
export const scanDiffSchema = z.object({
  new: severityCountsSchema,
  resolved: severityCountsSchema,
  regressed: severityCountsSchema,
  unchanged: severityCountsSchema,
  new_finding_ids: z.array(z.string()),
  regressed_finding_ids: z.array(z.string()),
  alert_new: severityCountsSchema,
  alert_regressed: severityCountsSchema,
});
export type ScanDiff = z.infer<typeof scanDiffSchema>;

export function emptyScanDiff(): ScanDiff {
  return {
    new: emptySeverityCounts(),
    resolved: emptySeverityCounts(),
    regressed: emptySeverityCounts(),
    unchanged: emptySeverityCounts(),
    new_finding_ids: [],
    regressed_finding_ids: [],
    alert_new: emptySeverityCounts(),
    alert_regressed: emptySeverityCounts(),
  };
}

export function diffHasChanges(diff: ScanDiff): boolean {
  return (
    diff.new_finding_ids.length > 0 ||
    diff.regressed_finding_ids.length > 0 ||
    hasPositiveCounts(diff.new) ||
    hasPositiveCounts(diff.resolved) ||
    hasPositiveCounts(diff.regressed)
  );
}

function hasPositiveCounts(counts: SeverityCounts): boolean {
  return (
    counts.critical > 0 ||
    counts.high > 0 ||
    counts.medium > 0 ||
    counts.low > 0 ||
    counts.info > 0
  );
}

/**
 * Response van `GET /api/scans/[id]/diff` (plan 59): de diff + de
 * diff-geselecteerde findings (nieuw + teruggekeerd) uit deze scan — de
 * opgeloste bevindingen zitten er niet (meer) in.
 */
export const scanDiffResponseSchema = z.object({
  diff: scanDiffSchema,
  findings: z.array(findingSchema),
});
export type ScanDiffResponse = z.infer<typeof scanDiffResponseSchema>;

/** Aantal bevindingen op of boven een ernst-drempel (bijv. ≥ medium). */
export function countAtOrAbove(
  counts: SeverityCounts,
  threshold: FindingSeverity,
): number {
  const minRank = severityRank[threshold];
  return (Object.keys(counts) as FindingSeverity[]).reduce(
    (sum, severity) =>
      sum + (severityRank[severity] >= minRank ? counts[severity] : 0),
    0,
  );
}

/**
 * Kern van de diff-berekening (plan 59 besluit 2):
 * - `new`         — in current, niet in snapshot (nieuw probleem)
 * - `resolved`    — in snapshot, niet meer in current (opgelost)
 * - `regressed`   — in snapshot met status fixed/ignored, nu open (was
 *                   afgewezen en komt terug — feature 20/plan 09)
 * - `unchanged`   — in beide, zonder status-overgang
 *
 * Actieve-test-findings (plan 52) worden niet meegeteld (consistent met de
 * score). `current` is de payload NA carry-over (finishScan past die toe).
 */
export function computeScanDiff(
  current: Finding[],
  snapshot: Finding[] | null,
  now: Date = new Date(),
): ScanDiff {
  const diff = emptyScanDiff();
  const snapshotByFp = new Map(
    snapshot?.map((finding) => [findingFingerprint(finding), finding]) ?? [],
  );
  const currentFps = new Set<string>();

  for (const finding of current) {
    if (finding.active) continue;
    const fp = findingFingerprint(finding);
    currentFps.add(fp);
    const snapshotFinding = snapshotByFp.get(fp);

    if (!snapshotFinding) {
      diff.new[finding.severity] += 1;
      diff.new_finding_ids.push(finding.id);
      if (!isSnoozed(finding, now)) {
        diff.alert_new[finding.severity] += 1;
      }
      continue;
    }

    if (
      finding.status === "open" &&
      (snapshotFinding.status === "fixed" || snapshotFinding.status === "ignored")
    ) {
      diff.regressed[finding.severity] += 1;
      diff.regressed_finding_ids.push(finding.id);
      if (!isSnoozed(finding, now)) {
        diff.alert_regressed[finding.severity] += 1;
      }
      continue;
    }

    diff.unchanged[finding.severity] += 1;
  }

  if (snapshot) {
    for (const finding of snapshot) {
      if (finding.active) continue;
      if (!currentFps.has(findingFingerprint(finding))) {
        diff.resolved[finding.severity] += 1;
      }
    }
  }

  return diff;
}
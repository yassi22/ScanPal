import {
  UPLOAD_CHECK_IDS,
  checkById,
  classifyUploadOutcome,
  truncateEvidence,
  type FindingEvidence,
  type FindingSeverity,
  type InlineCheckLike,
  type UploadCheckId,
  type UploadFlowCapture,
  type UploadProbeResult,
} from "@scanpal/shared";
import type { CheckContext, CheckImplementation } from "../types";
import type { BrowserRunner } from "./runner";

type UploadOutput = InlineCheckLike & {
  active: true;
  evidence: FindingEvidence | null;
};

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function evidenceOf(request: string, response: string): FindingEvidence {
  return { request: truncateEvidence(request), response: truncateEvidence(response) };
}

function nameOf(id: string): string {
  return checkById(id)?.name ?? id;
}

function skipFindings(reason: string): UploadOutput[] {
  return UPLOAD_CHECK_IDS.map((id) => ({
    id,
    name: nameOf(id),
    status: "info" as const,
    severity: "info" as const,
    detail: `Upload-scan overgeslagen: ${reason}`,
    active: true,
    evidence: null,
  }));
}

function relevantProbes(id: UploadCheckId, capture: UploadFlowCapture): UploadProbeResult[] {
  if (id === "upload-executable") {
    return capture.probes.filter((probe) => probe.active_type && probe.executed);
  }
  return capture.probes.filter((probe) => probe.probe_id === id);
}

function findingFor(id: UploadCheckId, capture: UploadFlowCapture): UploadOutput {
  const probes = relevantProbes(id, capture);
  if (probes.length === 0) {
    return {
      id,
      name: nameOf(id),
      status: "info",
      severity: "info",
      detail: "Geen relevante upload-probe-observatie beschikbaar.",
      active: true,
      evidence: null,
    };
  }

  const hasClientRestriction = capture.forms.some((form) => form.accept_attribute !== null);
  const observations = probes.map((probe) => {
    const stored = probe.accepted && probe.stored_url !== null;
    const outcome = classifyUploadOutcome({
      stored,
      retrievable: probe.retrieved,
      executed: probe.executed,
      activeType: id === "upload-content-sniff" && probe.active_type,
      clientSideRestriction: hasClientRestriction && probe.active_type,
    });
    return { probe, outcome };
  });
  const worst = observations.reduce((selected, candidate) =>
    SEVERITY_RANK[candidate.outcome.severity] > SEVERITY_RANK[selected.outcome.severity]
      ? candidate
      : selected,
  );
  const { probe, outcome } = worst;
  const status = outcome.severity === "high"
    ? "fail"
    : outcome.severity === "medium" || outcome.severity === "low"
      ? "warn"
      : "pass";
  const leftover = probe.stored_url && capture.leftover_files.includes(probe.stored_url)
    ? ` Canary-bestand bleef achter op de geverifieerde site: ${probe.stored_url}.`
    : "";
  const detail = `${probe.filename} als ${probe.content_type}: ${outcome.reason}.${leftover}`;
  const response = [
    `HTTP ${probe.status}`,
    `accepted=${probe.accepted}`,
    `stored_url=${probe.stored_url ?? "geen"}`,
    `retrieved=${probe.retrieved}`,
    `executed=${probe.executed}`,
    probe.retrieved_body,
  ].join("\n");

  return {
    id,
    name: nameOf(id),
    status,
    severity: outcome.severity,
    detail,
    active: true,
    evidence: outcome.severity === "info"
      ? null
      : evidenceOf(
        `upload ${probe.filename}\nContent-Type: ${probe.content_type}`,
        response,
      ),
  };
}

/**
 * File-upload-scanner (plan 78). Actieve, inerte canary-probes achter opt-in
 * en live eigendomsverificatie. Credentials zijn optioneel: publieke upload-
 * formulieren blijven zonder account meetbaar; een account ontsluit alleen
 * formulieren achter login.
 */
export function createFileUploadCheck(runner: BrowserRunner): CheckImplementation {
  return {
    id: "upload-scan",
    category: "http",
    async run(ctx: CheckContext): Promise<InlineCheckLike[]> {
      if (!ctx.activeTests) return [];

      if (ctx.ownershipVerified === false) {
        return skipFindings(
          "domeineigendom niet live geverifieerd (plan 76). Verifieer eerst eigendom via de DNS-TXT-record.",
        );
      }

      const rate = await ctx.rateLimit(`upload-scan:${new URL(ctx.url).hostname}`, 5, 60);
      if (!rate.ok) {
        return skipFindings(`rate-limit (probeer opnieuw over ${rate.retryAfterSeconds}s).`);
      }

      const result = await runner.captureUploadFlow(ctx.url, ctx.authCredentials ?? null);
      if (!result.ok) {
        return skipFindings(`browser-capture mislukt: ${result.error}`);
      }
      if (result.capture.forms.length === 0) {
        return UPLOAD_CHECK_IDS.map((id) => ({
          id,
          name: nameOf(id),
          status: "info" as const,
          severity: "info" as const,
          detail: "Geen upload-formulieren gevonden.",
          active: true as const,
          evidence: null,
        }));
      }

      return UPLOAD_CHECK_IDS.map((id) => findingFor(id, result.capture));
    },
  };
}

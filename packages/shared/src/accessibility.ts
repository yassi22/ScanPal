import { z } from "zod";

/**
 * Feature 42 — Accessibility-scan (category aeo, axe-core). Pure logica voor
 * het normaliseren van axe-core JSON-output (via @axe-core/playwright) naar
 * violations + evidence. De worker-wrapper in
 * `apps/worker/src/checks/browser/accessibility.ts` draait axe via de
 * injectable BrowserRunner en voert de ruwe output aan deze helpers.
 *
 * Besluiten:
 * - axe retourneert `violations[]` met `impact` ∈ {minor, moderate, serious,
 *   critical}. We mappen critical/serious → fail, moderate/minor → warn.
 * - Samples worden gecapteerd op 10 per impact-groep (evidence-grootte).
 * - Nodes bevatten selectors + html-snippets (geen PII).
 */

export type AxeImpact = "minor" | "moderate" | "serious" | "critical";

export type AxeViolation = {
  id: string;
  impact: AxeImpact;
  help: string;
  tags: string[];
  node_count: number;
  /** Eerste N selectors (voor evidence). */
  selectors: string[];
};

export const axeViolationSchema = z.object({
  id: z.string(),
  impact: z.enum(["minor", "moderate", "serious", "critical"]),
  help: z.string(),
  tags: z.array(z.string()),
  node_count: z.number().int(),
  selectors: z.array(z.string()),
});

type AxeNode = {
  target?: unknown;
  html?: unknown;
};

type AxeResultViolation = {
  id?: unknown;
  impact?: unknown;
  help?: unknown;
  tags?: unknown;
  nodes?: unknown;
};

/** Parseren van de ruwe axe-results `violations[]`-array. */
export function parseAxeViolations(violations: unknown): AxeViolation[] {
  if (!Array.isArray(violations)) return [];
  const result: AxeViolation[] = [];
  for (const v of violations) {
    if (!v || typeof v !== "object") continue;
    const row = v as AxeResultViolation;
    if (typeof row.id !== "string") continue;
    const impact = typeof row.impact === "string" ? (row.impact as AxeImpact) : "minor";
    const nodes = Array.isArray(row.nodes) ? (row.nodes as AxeNode[]) : [];
    const selectors = nodes
      .map((n) => (Array.isArray(n.target) && n.target.length > 0 ? String(n.target[0]) : null))
      .filter((s): s is string => s !== null)
      .slice(0, 10);
    result.push({
      id: row.id,
      impact,
      help: typeof row.help === "string" ? row.help : "",
      tags: Array.isArray(row.tags) ? (row.tags as string[]).map(String) : [],
      node_count: nodes.length,
      selectors,
    });
  }
  return result;
}

export type AxeEvidence = {
  kind: "accessibility";
  total: number;
  by_impact: { critical: number; serious: number; moderate: number; minor: number };
  samples: { id: string; impact: string; help: string; node_count: number; selectors: string[] }[];
};

export const axeEvidenceSchema = z.object({
  kind: z.literal("accessibility"),
  total: z.number().int(),
  by_impact: z.object({
    critical: z.number().int(),
    serious: z.number().int(),
    moderate: z.number().int(),
    minor: z.number().int(),
  }),
  samples: z.array(
    z.object({
      id: z.string(),
      impact: z.string(),
      help: z.string(),
      node_count: z.number().int(),
      selectors: z.array(z.string()),
    }),
  ),
});

export function axeEvidence(violations: AxeViolation[]): AxeEvidence {
  const by = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) by[v.impact] += 1;
  return {
    kind: "accessibility",
    total: violations.length,
    by_impact: by,
    samples: violations.slice(0, 10).map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      node_count: v.node_count,
      selectors: v.selectors,
    })),
  };
}

/**
 * Overall-status: critical/serious → fail, moderate/minor → warn, anders pass.
 */
export function axeOverallStatus(violations: AxeViolation[]): "pass" | "warn" | "fail" {
  if (violations.some((v) => v.impact === "critical" || v.impact === "serious")) return "fail";
  if (violations.some((v) => v.impact === "moderate" || v.impact === "minor")) return "warn";
  return "pass";
}

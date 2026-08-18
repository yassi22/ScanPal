import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { writeScanCrux } from "@scanpal/scan-core";
import {
  checkById,
  type CruxData,
  type CruxEvidence,
} from "@scanpal/shared";
import { env } from "../../env";
import { createCruxClient } from "../../lib/crux";
import type { CheckImplementation } from "../types";

const NAME = "CrUX field data (real-user CWV)";

function safeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function p75(value: number | null, unit: string): string {
  return value === null ? "—" : `${value}${unit}`;
}

/** Korte menselijke samenvatting voor de finding-detail. */
export function summarizeCrux(data: CruxData): string {
  const m = data.metrics;
  return (
    `Periode ${data.collection_period}: LCP p75 ${p75(m.lcp.p75, "ms")} ` +
    `(good ${pct(m.lcp.good)}, ni ${pct(m.lcp.needs_improvement)}, poor ${pct(m.lcp.poor)}) · ` +
    `INP p75 ${p75(m.inp.p75, "ms")} ` +
    `(good ${pct(m.inp.good)}, ni ${pct(m.inp.needs_improvement)}, poor ${pct(m.inp.poor)}) · ` +
    `CLS p75 ${p75(m.cls.p75, "")} ` +
    `(good ${pct(m.cls.good)}, ni ${pct(m.cls.needs_improvement)}, poor ${pct(m.cls.poor)})`
  );
}

/**
 * Plan 62 — CrUX field data (besluit 1: HTTP-check, geen browser nodig).
 * Draait in de http-worker (categorie aeo); schrijft het genormaliseerde
 * resultaat in `scans.crux` (besluit 2). Geen data → info-finding, geen
 * score-straf (besluit 3). Max 1 API-call per origin per 24u via de
 * Redis-cache; 429/API-fouten faalden nooit hard (acceptatiecriterium).
 */
export function createCruxFieldDataCheck(deps: {
  redis: Redis;
  db: Pool;
}): CheckImplementation {
  const client = createCruxClient({
    apiKey: env.CRUX_API_KEY ?? null,
    redis: deps.redis,
  });

  return {
    id: "crux-field-data",
    category: "aeo",
    async run(ctx) {
      const name = checkById("crux-field-data")?.name ?? NAME;
      const origin = safeOrigin(ctx.url);

      if (!env.CRUX_API_KEY) {
        await writeScanCrux(deps.db, ctx.scanId, null);
        return [
          {
            id: "crux-field-data",
            name,
            status: "info",
            detail:
              "Geen CrUX API-key geconfigureerd (env CRUX_API_KEY) — field data overgeslagen.",
          },
        ];
      }

      try {
        const data = await client.fetchCrux(origin);
        await writeScanCrux(deps.db, ctx.scanId, data);
        if (!data) {
          return [
            {
              id: "crux-field-data",
              name,
              status: "info",
              detail:
                "Geen CrUX field data beschikbaar — deze origin heeft onvoldoende Chrome-verkeer (CrUX dekt alleen voldoende bezochte origins).",
            },
          ];
        }
        const evidence: CruxEvidence = { kind: "crux-field-data", data };
        return [
          {
            id: "crux-field-data",
            name,
            status: "pass",
            detail: summarizeCrux(data),
            evidence,
          },
        ];
      } catch (err) {
        const message = err instanceof Error ? err.message : "Onbekende fout";
        await writeScanCrux(deps.db, ctx.scanId, null);
        return [
          {
            id: "crux-field-data",
            name,
            status: "info",
            detail: `CrUX field data niet controleerbaar: ${message}`,
          },
        ];
      }
    },
  };
}

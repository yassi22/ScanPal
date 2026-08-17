import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import { getPublicStatus } from "@/lib/public-status-core";
import { PublicStatusChart } from "@/components/public-status-chart";
import {
  formatDateTime,
  formatUptimePct,
  incidentDuration,
  statusLabel,
} from "@/lib/uptime-format";

export const dynamic = "force-dynamic";

/**
 * Publieke statuspagina (plan 57) — geen login, alleen uptime-data.
 * De slug is opt-in per site en niet-rabar; de pagina is noindex en
 * bestaat alleen voor actieve slugs (onbekende slug → 404).
 */
export function generateMetadata(): Metadata {
  return {
    title: "Status",
    robots: { index: false, follow: false },
  };
}

const STATUS_DOT: Record<string, string> = {
  up: "bg-emerald-400",
  down: "bg-rose-500",
  unknown: "bg-slate-500",
};

const ERROR_LABELS: Record<string, string> = {
  timeout: "time-out",
  dns: "DNS-fout",
  tls: "TLS/certificaat",
  connect: "verbinding geweigerd",
  network: "netwerkfout",
  "http-5xx": "HTTP 5xx",
  "too-many-redirects": "te veel redirects",
  "invalid-url": "ongeldige URL",
  other: "overig",
};

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const status = await getPublicStatus(pool, slug);
  if (!status) notFound();

  return (
    <main className="flex-1 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-sm font-bold text-slate-200">
            ScanPal
          </Link>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
            Publieke statuspagina
          </span>
        </header>

        <section className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <span
            className={`h-4 w-4 shrink-0 rounded-full ${STATUS_DOT[status.status]}`}
            aria-hidden
          />
          <div>
            <p className="text-lg font-bold text-slate-100">{status.site_host}</p>
            <p className="text-sm text-slate-400">
              {statusLabel(status.status)}
              {status.status === "unknown" &&
                " — nog geen uptime-metingen voor deze site."}
            </p>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <Metric
            label="Uptime 30 dagen"
            value={formatUptimePct(status.uptime_30d)}
          />
          <Metric label="Uptime 90 dagen" value={formatUptimePct(status.uptime_90d)} />
        </div>

        <PublicStatusChart slug={slug} initial={status.series} />

        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="font-semibold">Incidenten</h2>
          {status.incidents.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              Geen incidenten in de afgelopen 30 dagen.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-800/60 text-sm">
              {status.incidents.map((incident) => (
                <li
                  key={`${incident.start}-${incident.end ?? "open"}`}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <div>
                      <p className="font-medium text-slate-200">Storing</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(incident.start)} →{" "}
                        {incident.end
                          ? formatDateTime(incident.end)
                          : "loopt nog"}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-400">
                    <p>
                      {incidentDuration(incident.start, incident.end)}
                    </p>
                    {incident.error_class && (
                      <p className="text-slate-500">
                        {ERROR_LABELS[incident.error_class] ??
                          incident.error_class}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="pb-4 text-center text-xs text-slate-600">
          Deze pagina wordt bijgewerkt door ScanPal — website security &amp; SEO
          scanner.
        </footer>
      </div>
    </main>
  );
}
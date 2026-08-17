"use client";

import { useCallback, useState } from "react";
import type { PublicStatusDay } from "@scanpal/shared";

type Props = {
  slug: string;
  initial: PublicStatusDay[];
};

const UP_COLOR = "#34d399";
const DOWN_COLOR = "#f43f5e";
const NODATA_COLOR = "#334155";
const GRID_COLOR = "#1e293b";

/**
 * Plan 57 — client-side 30/90-dagen-grafiek voor de publieke statuspagina.
 * Eigen SVG (geen chart-library): één balk per dag, up/down/geen-data.
 * Haalt het andere venster via de publieke JSON-feed op.
 */
export function PublicStatusChart({ slug, initial }: Props) {
  const [days, setDays] = useState<30 | 90>(30);
  const [series, setSeries] = useState<PublicStatusDay[]>(initial);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (target: 30 | 90) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/public/status/${slug}?days=${target}`);
        if (!res.ok) return;
        const data = await res.json();
        setSeries(data.series ?? []);
        setDays(target);
      } finally {
        setLoading(false);
      }
    },
    [slug],
  );

  const width = 640;
  const height = 120;
  const padding = { top: 10, right: 6, bottom: 22, left: 6 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const barWidth = Math.max(1, plotWidth / Math.max(1, series.length) - 1);
  const xFor = (index: number) =>
    padding.left + index * (barWidth + 1);

  const barColor = (status: PublicStatusDay["status"]) =>
    status === "up" ? UP_COLOR : status === "down" ? DOWN_COLOR : NODATA_COLOR;

  const bucketLabel = (index: number) => {
    const count = Math.max(1, Math.floor(series.length / 5));
    if (index % count !== 0) return null;
    const [y, m, d] = series[index].day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
    });
  };

  const upCount = series.filter((s) => s.status === "up").length;
  const downCount = series.filter((s) => s.status === "down").length;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Geschiedenis</h2>
        <div className="flex gap-1 rounded-lg border border-slate-700 p-1 text-xs">
          <button
            type="button"
            onClick={() => void load(30)}
            disabled={loading}
            className={`rounded-md px-3 py-1.5 font-semibold transition disabled:opacity-50 ${
              days === 30
                ? "bg-brand text-slate-950"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            30 dagen
          </button>
          <button
            type="button"
            onClick={() => void load(90)}
            disabled={loading}
            className={`rounded-md px-3 py-1.5 font-semibold transition disabled:opacity-50 ${
              days === 90
                ? "bg-brand text-slate-950"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            90 dagen
          </button>
        </div>
      </div>

      {series.length === 0 ? (
        <p className="mt-6 py-10 text-center text-sm text-slate-500">
          Nog geen gegevens in dit venster.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="mt-4 w-full"
            role="img"
            aria-label={`Uptime-grafiek laatste ${days} dagen`}
          >
            {[0, 1, 2, 3].map((i) => (
              <line
                key={i}
                x1={padding.left}
                x2={width - padding.right}
                y1={padding.top + (i / 3) * plotHeight}
                y2={padding.top + (i / 3) * plotHeight}
                stroke={GRID_COLOR}
                strokeDasharray="3 3"
              />
            ))}

            {series.map((point, index) => (
              <rect
                key={index}
                x={xFor(index)}
                y={padding.top}
                width={barWidth}
                height={plotHeight}
                fill={barColor(point.status)}
                opacity={point.status === "nodata" ? 0.6 : 0.9}
              />
            ))}

            {series.map((point, index) =>
              bucketLabel(index) ? (
                <text
                  key={`label-${index}`}
                  x={xFor(index) + barWidth / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#64748b"
                >
                  {bucketLabel(index)}
                </text>
              ) : null,
            )}
          </svg>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Online
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> Offline
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-600" /> Geen data
            </span>
            <span className="ml-auto">
              {upCount} online · {downCount} offline in {days} dagen
            </span>
          </div>
        </>
      )}
    </div>
  );
}
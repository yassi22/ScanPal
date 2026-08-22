"use client";

import { useCallback, useState } from "react";
import type { UptimeDetail } from "@scanpal/shared";

type Props = {
  siteId: string;
  initial: UptimeDetail;
};

const RED_COLOR = "#f43f5e";
const GREEN_COLOR = "#34d399";
const GRID_COLOR = "#1e293b";

/**
 * 30/90-dagen-grafiek (eigen SVG, geen dependency) met toggle-knoppen die
 * het venster via de API ophalen. Groene punten = uur/dag volledig up,
 * rode punten = (deels) down.
 */
export function UptimeChart({ siteId, initial }: Props) {
  const [days, setDays] = useState<30 | 90>(30);
  const [detail, setDetail] = useState<UptimeDetail>(initial);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (target: 30 | 90) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/uptime/sites/${siteId}?days=${target}`);
        if (!res.ok) return;
        const data = await res.json();
        setDetail(data);
        setDays(target);
      } finally {
        setLoading(false);
      }
    },
    [siteId],
  );

  const series = detail.series;
  const width = 640;
  const height = 180;
  const padding = { top: 12, right: 12, bottom: 22, left: 36 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxLatency = Math.max(
    100,
    ...series.map((s) => s.avg_latency_ms ?? 0),
  );
  const maxValue = Math.max(100, maxLatency);

  const xFor = (index: number) =>
    padding.left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
  const yFor = (value: number) =>
    padding.top + plotHeight - (value / maxValue) * plotHeight;

  const gridLines = [0, 25, 50, 75, 100].map((pct) => ({
    y: yFor((pct / 100) * maxValue),
    label: `${pct}%`,
  }));

  const points = series.map((point, index) => ({
    x: xFor(index),
    y: yFor(point.up_pct / 100 > 0 ? (point.up_pct / 100) * maxValue : 0),
    color: point.up_pct === 100 ? GREEN_COLOR : RED_COLOR,
  }));

  const bucketLabel = (index: number) => {
    const count = Math.max(1, Math.floor(series.length / 4));
    if (index % count !== 0) return null;
    const date = new Date(series[index].at);
    if (days === 30) {
      return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    }
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

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
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-4 w-full"
          role="img"
          aria-label={`Uptime-grafiek laatste ${days} dagen`}
        >
          {gridLines.map((line) => (
            <g key={line.label}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={line.y}
                y2={line.y}
                stroke={GRID_COLOR}
                strokeDasharray="3 3"
              />
              <text
                x={padding.left - 6}
                y={line.y + 3}
                textAnchor="end"
                fontSize={10}
                fill="#64748b"
              >
                {line.label}
              </text>
            </g>
          ))}

          {points.map((point, index) => (
            <line
              key={index}
              x1={point.x}
              x2={point.x}
              y1={padding.top}
              y2={padding.top + plotHeight}
              stroke={point.color}
              strokeWidth={days === 30 ? 1.5 : 4}
              opacity={0.85}
            />
          ))}

          {series.map((point, index) =>
            bucketLabel(index) ? (
              <text
                key={index}
                x={xFor(index)}
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
      )}
    </div>
  );
}

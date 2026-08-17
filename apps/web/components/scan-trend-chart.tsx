"use client";

import { useMemo } from "react";
import type { ScanTrendPoint, ScanCategory } from "@scanpal/shared";
import { scanCategories, categoryLabels } from "@scanpal/shared";

type Props = {
  points: ScanTrendPoint[];
};

const GRID_COLOR = "#1e293b";
const AXIS_COLOR = "#64748b";

const OVERALL_COLOR = "#60a5fa";
const CATEGORY_COLORS: Record<ScanCategory, string> = {
  http: "#34d399",
  seo: "#a78bfa",
  aeo: "#fbbf24",
  github: "#f472b6",
};

/**
 * Feature 10 — score-trend per site. SVG-lijngrafiek (geen dependency)
 * met de overall-score als gevulde lijn en per-categorie-scores als
 * dunnere lijnen. `null`-scores (failed scans) worden verbonden via
 * null-gates zodat de lijn onderbreekt i.p.v. naar 0 te zakken.
 */
export function ScanTrendChart({ points }: Props) {
  const series = useMemo(() => {
    const withIndex = points.map((p, i) => ({ ...p, _i: i }));
    const overall = withIndex.map((p) => ({
      x: p._i,
      value: p.score,
      at: p.created_at,
    }));
    const categories: Record<ScanCategory, { x: number; value: number | null; at: string }[]> = {
      http: [],
      seo: [],
      aeo: [],
      github: [],
    };
    for (const p of withIndex) {
      const cs = p.category_scores;
      for (const cat of scanCategories) {
        categories[cat].push({
          x: p._i,
          value: cs ? cs[cat] : null,
          at: p.created_at,
        });
      }
    }
    return { overall, categories };
  }, [points]);

  const width = 640;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const n = points.length;
  const xFor = (i: number) =>
    padding.left + (n <= 1 ? plotWidth / 2 : (i / (n - 1)) * plotWidth);
  const yFor = (value: number) =>
    padding.top + plotHeight - (value / 100) * plotHeight;

  const gridLines = [0, 25, 50, 75, 100].map((pct) => ({
    y: yFor(pct),
    label: `${pct}`,
  }));

  /**
   * Bouw een SVG-path over de punten; null-waarden onderbreken de lijn
   * (move zonder draw). `gap` zet de pen neer bij het volgende reële punt.
   */
  function buildPath(
    data: { value: number | null }[],
  ): { d: string; hasAny: boolean } {
    let d = "";
    let hasAny = false;
    let pen = false;
    data.forEach((point, i) => {
      if (point.value === null) {
        pen = false;
        return;
      }
      hasAny = true;
      const cmd = pen ? "L" : "M";
      d += `${cmd}${xFor(i).toFixed(1)},${yFor(point.value).toFixed(1)} `;
      pen = true;
    });
    return { d: d.trim(), hasAny };
  }

  const overallPath = buildPath(series.overall);

  const dateLabel = (index: number) => {
    const count = Math.max(1, Math.floor(n / 4));
    if (index % count !== 0) return null;
    const p = points[index];
    if (!p) return null;
    return new Date(p.created_at).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
    });
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Score-trend</h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-3 rounded-full"
              style={{ backgroundColor: OVERALL_COLOR }}
            />
            Overall
          </span>
          {scanCategories.map((cat) => (
            <span key={cat} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-3 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[cat] }}
              />
              {categoryLabels[cat]}
            </span>
          ))}
        </div>
      </div>

      {n === 0 ? (
        <p className="mt-6 py-10 text-center text-sm text-slate-500">
          Nog geen voltooide scans voor deze site.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-4 w-full"
          role="img"
          aria-label="Score-trend per scan"
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
                fill={AXIS_COLOR}
              >
                {line.label}
              </text>
            </g>
          ))}

          {overallPath.hasAny && (
            <path
              d={overallPath.d}
              fill="none"
              stroke={OVERALL_COLOR}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {scanCategories.map((cat) => {
            const path = buildPath(series.categories[cat]);
            if (!path.hasAny) return null;
            return (
              <path
                key={cat}
                d={path.d}
                fill="none"
                stroke={CATEGORY_COLORS[cat]}
                strokeWidth={1.25}
                strokeOpacity={0.8}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {overallPath.hasAny &&
            series.overall.map((p, i) =>
              p.value === null ? null : (
                <circle
                  key={i}
                  cx={xFor(i)}
                  cy={yFor(p.value)}
                  r={2.5}
                  fill={OVERALL_COLOR}
                />
              ),
            )}

          {points.map((_, i) =>
            dateLabel(i) ? (
              <text
                key={i}
                x={xFor(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize={10}
                fill={AXIS_COLOR}
              >
                {dateLabel(i)}
              </text>
            ) : null,
          )}
        </svg>
      )}
    </div>
  );
}

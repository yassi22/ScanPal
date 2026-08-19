import type { UptimeSeriesPoint } from "@scanpal/shared";

type Props = {
  points: UptimeSeriesPoint[];
  width?: number;
  height?: number;
};

const RED_COLOR = "#f43f5e";
const GREEN_COLOR = "#34d399";
/**
 * Lichte SVG-sparkline (24u uurbuckets) zonder dependencies; per punt een
 * verticale lijn in de uptime-kleur. Vervangbaar door een chart-lib in v2.
 */
export function Sparkline({ points, width = 120, height = 28 }: Props) {
  if (points.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className="text-slate-700"
        aria-label="Nog geen uptime-gegevens"
      >
        <rect width={width} height={height} rx={4} fill="currentColor" />
      </svg>
    );
  }

  const step = width / points.length;
  const barHeight = height - 6;

  return (
    <svg
      width={width}
      height={height}
      aria-hidden
      className="uptime-sparkline rounded bg-slate-950/60"
    >
      {points.map((point, index) => {
        const color = point.up_pct === 100 ? GREEN_COLOR : RED_COLOR;
        const bar = Math.max(2, Math.round((point.up_pct / 100) * barHeight));
        return (
          <rect
            key={point.at}
            x={Math.round(index * step) + 1}
            y={height - bar}
            width={Math.max(2, Math.floor(step) - 2)}
            height={bar}
            rx={1}
            fill={color}
          />
        );
      })}
    </svg>
  );
}

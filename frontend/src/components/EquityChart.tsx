import { useMemo } from "react";
import type { EquityPoint } from "../types.pages";
import { formatInt } from "../lib/format";

interface Props {
  points: readonly EquityPoint[];
  height?: number;
}

/** Area + line equity curve with a drawdown ribbon. Hand-rolled SVG. */
export function EquityChart({ points, height = 260 }: Props) {
  const layout = useMemo(() => {
    if (points.length < 2) return null;

    const w = 1000;
    const padR = 68;
    const padT = 10;
    const padB = 6;
    const plotW = w - padR;

    const values = points.map((p) => p.equity);
    let max = Math.max(...values);
    let min = Math.min(...values);
    const pad = (max - min) * 0.08 || 1;
    max += pad;
    min -= pad;
    const range = max - min || 1;

    const x = (i: number) => (i / (points.length - 1)) * plotW;
    const y = (v: number) => padT + ((max - v) / range) * (height - padT - padB);

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.equity).toFixed(2)}`).join(" ");
    const area = `${line} L${plotW},${height - padB} L0,${height - padB} Z`;

    // Where the series crosses its starting value — the zero-PnL baseline.
    const start = points[0]!.equity;
    const baselineY = y(start);

    const grid = Array.from({ length: 5 }, (_, i) => {
      const v = min + (range / 4) * i;
      return { v, y: y(v) };
    });

    const worst = Math.min(...points.map((p) => p.drawdown_pct));

    return { w, plotW, line, area, grid, baselineY, worst, first: points[0]!, last: points[points.length - 1]! };
  }, [points, height]);

  if (!layout) {
    return (
      <div className="state-block" role="status">
        Not enough history to draw an equity curve.
      </div>
    );
  }

  const { w, plotW, line, area, grid, baselineY, first, last } = layout;
  const gained = last.equity >= first.equity;

  return (
    <svg
      className="equity-chart"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Equity curve from ${formatInt(first.equity)} to ${formatInt(last.equity)}`}
    >
      {grid.map((g) => (
        <g key={g.v}>
          <line x1={0} x2={plotW} y1={g.y} y2={g.y} className="chart-grid" />
          <text x={plotW + 6} y={g.y + 3} className="chart-axis-label">
            {formatInt(g.v)}
          </text>
        </g>
      ))}

      {/* Starting-capital baseline. */}
      <line
        x1={0}
        x2={plotW}
        y1={baselineY}
        y2={baselineY}
        className="chart-baseline"
        strokeDasharray="3 3"
      />

      <path d={area} className={gained ? "equity-area-up" : "equity-area-down"} />
      <path d={line} className={gained ? "equity-line-up" : "equity-line-down"} fill="none" />

      <text x={2} y={height - 1} className="chart-axis-label">
        {first.date}
      </text>
      <text x={plotW - 2} y={height - 1} className="chart-axis-label" textAnchor="end">
        {last.date}
      </text>
    </svg>
  );
}

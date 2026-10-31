import { useMemo } from "react";
import type { EquityPoint } from "../types.pages";
import { formatInt } from "../lib/format";

export interface Series {
  key: string;
  label: string;
  points: readonly EquityPoint[];
  /** CSS colour token name suffix: `up` | `down` | `accent` | `info`. */
  tone: string;
}

interface Props {
  series: readonly Series[];
  height?: number;
}

const PAD_R = 72;
const PAD_T = 10;
const PAD_B = 8;

/**
 * Multi-series equity chart: every line shares one Y axis so the strategies are
 * directly comparable at a glance.
 *
 * Sharing the scale is the whole point. Two independently-scaled charts flatter
 * whichever series happens to have the larger range, and make it impossible to
 * see where one crossed the other.
 */
export function MultiLineChart({ series, height = 300 }: Props) {
  const layout = useMemo(() => {
    const withPoints = series.filter((s) => s.points.length >= 2);
    if (withPoints.length === 0) return null;

    const w = 1000;
    const plotW = w - PAD_R;

    // One shared domain across EVERY series.
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (const s of withPoints) {
      for (const p of s.points) {
        if (!Number.isFinite(p.equity)) continue;
        if (p.equity < min) min = p.equity;
        if (p.equity > max) max = p.equity;
        count++;
      }
    }
    if (count === 0) return null;

    const pad = (max - min) * 0.08 || 1;
    min -= pad;
    max += pad;
    const span = max - min || 1;

    const longest = Math.max(...withPoints.map((s) => s.points.length));
    const x = (i: number, n: number) => (n <= 1 ? 0 : (i / (n - 1)) * plotW);
    const y = (v: number) => PAD_T + ((max - v) / span) * (height - PAD_T - PAD_B);

    const lines = withPoints.map((s) => {
      const d = s.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(i, s.points.length).toFixed(2)},${y(p.equity).toFixed(2)}`)
        .join(" ");
      return { key: s.key, label: s.label, tone: s.tone, d, last: s.points[s.points.length - 1]! };
    });

    const grid = Array.from({ length: 5 }, (_, i) => {
      const v = min + (span / 4) * i;
      return { v, y: y(v) };
    });

    // A shared baseline at the first series' starting capital.
    const baseline = withPoints[0]!.points[0]!.equity;

    return { w, plotW, lines, grid, baseline, baselineY: y(baseline), longest, max, span };
  }, [series, height]);

  if (layout === null) {
    return (
      <div className="state-block" role="status">
        Not enough history to draw a comparison.
      </div>
    );
  }

  const { w, plotW, lines, grid, baselineY, max, span } = layout;

  return (
    <div className="mlc-wrap">
      <ul className="mlc-legend" aria-label="Series legend">
        {lines.map((l) => (
          <li key={l.key} className={`mlc-legend-item mlc-tone-${l.tone}`}>
            <span className="mlc-swatch" aria-hidden="true" />
            <span className="mlc-legend-label">{l.label}</span>
            <span className="mlc-legend-value">{formatInt(l.last.equity)}</span>
          </li>
        ))}
      </ul>

      <svg
        className="multi-line-chart"
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Equity comparison of ${lines.map((l) => l.label).join(" and ")}`}
      >
        {grid.map((g) => (
          <g key={g.v}>
            <line x1={0} x2={plotW} y1={g.y} y2={g.y} className="chart-grid" />
            <text x={plotW + 6} y={g.y + 3} className="chart-axis-label">
              {formatInt(g.v)}
            </text>
          </g>
        ))}

        {/* Starting-capital baseline: crossing it is the break-even moment. */}
        <line
          x1={0}
          x2={plotW}
          y1={baselineY}
          y2={baselineY}
          className="chart-baseline"
          strokeDasharray="3 3"
        />

        {lines.map((l) => (
          <path key={l.key} d={l.d} className={`mlc-line mlc-tone-${l.tone}`} fill="none" />
        ))}

        {/* A dot at each series' final value, placed on the shared scale. */}
        {lines.map((l) => {
          const cy =
            PAD_T + ((max - l.last.equity) / span) * (height - PAD_T - PAD_B);
          return (
            <circle
              key={`${l.key}-end`}
              cx={plotW}
              cy={cy}
              r={2.5}
              className={`mlc-end-dot mlc-tone-${l.tone}`}
            />
          );
        })}
      </svg>

      <p className="mlc-note">
        Both strategies share one axis, so a crossover between the lines is a real
        crossover. The dashed line marks the opening capital.
      </p>
    </div>
  );
}

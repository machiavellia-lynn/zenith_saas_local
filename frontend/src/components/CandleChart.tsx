import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "../types.pages";

interface Props {
  /** The full series, oldest first. The chart shows a window onto it. */
  candles: readonly Candle[];
  height?: number;
  /**
   * How many of the newest candles are in view to begin with. Omitted, the whole
   * series is. Drag pans, the wheel zooms, a double click returns to this view.
   */
  initialCount?: number;
}

const PAD_R = 64;
const PAD_T = 8;
const PAD_B = 8;
const VIEW_W = 1000;
/** The fewest candles zoom will go down to. */
const MIN_VISIBLE = 10;
/** One wheel notch scales the visible count by this much. */
const ZOOM_STEP = 0.85;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Which candles are in view: `count` of them, ending just before index `end`. */
interface View {
  count: number;
  end: number;
}

/**
 * An SVG candlestick chart with a volume histogram beneath it.
 *
 * Hand-rolled rather than a charting dependency: the requirement is a specific
 * dense terminal look, and a general-purpose chart library fights every one of
 * those decisions while adding ~100 KB. SVG keeps it crisp at any zoom and
 * testable through the DOM.
 *
 * Interaction, TradingView-style: drag to pan through history, scroll to zoom
 * around the cursor, double-click to go back to the opening view. The price
 * scale refits to whatever is in view.
 */
export function CandleChart({ candles: all, height = 360, initialCount }: Props) {
  const total = all.length;
  const minVisible = Math.min(MIN_VISIBLE, total);
  const openingCount = clamp(initialCount ?? total, minVisible, total);

  // null = the opening view. Any new series (another ticker, another end date)
  // starts from it again.
  const [view, setView] = useState<View | null>(null);
  useEffect(() => setView(null), [all]);

  const count = clamp(view?.count ?? openingCount, minVisible, total);
  const end = clamp(view?.end ?? total, count, total);
  const candles = useMemo(() => all.slice(end - count, end), [all, end, count]);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; end: number } | null>(null);
  // The wheel listener is attached once, so it reads the latest view from here.
  const latest = useRef({ count, end, total, minVisible });
  latest.current = { count, end, total, minVisible };

  /** Width of the candle area as drawn on screen, in px. */
  const plotPx = (): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? (rect.width * (VIEW_W - PAD_R)) / VIEW_W : 0;
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = latest.current;
      if (s.total === 0) return;
      // React attaches wheel listeners as passive, which cannot stop the page
      // scrolling underneath; this one is native for that reason.
      e.preventDefault();
      const px = plotPx();
      const rect = el.getBoundingClientRect();
      const f = px > 0 ? clamp((e.clientX - rect.left) / px, 0, 1) : 1;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      let next = Math.round(s.count * factor);
      if (next === s.count) next += e.deltaY < 0 ? -1 : 1;
      next = clamp(next, s.minVisible, s.total);
      // Keep the candle under the cursor where it is.
      const anchor = s.end - s.count + f * s.count;
      const start = anchor - f * next;
      setView({ count: next, end: clamp(Math.round(start + next), next, s.total) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, end };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d === null) return;
    const px = plotPx();
    if (px <= 0) return;
    // Dragging right pulls earlier candles into view.
    const shift = Math.round((e.clientX - d.x) / (px / count));
    const nextEnd = clamp(d.end - shift, count, total);
    if (nextEnd !== end) setView({ count, end: nextEnd });
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const layout = useMemo(() => {
    if (candles.length === 0) return null;

    const w = VIEW_W;
    const priceH = height * 0.74;
    const volH = height * 0.22;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    let max = Math.max(...highs);
    let min = Math.min(...lows);
    const pad = (max - min) * 0.06 || 1;
    max += pad;
    min -= pad;
    const range = max - min || 1;

    const maxVol = Math.max(...candles.map((c) => c.volume)) || 1;

    const plotW = w - PAD_R;
    const slot = plotW / candles.length;
    const bodyW = Math.max(1, Math.min(slot * 0.62, 9));

    const yPrice = (p: number) =>
      PAD_T + ((max - p) / range) * (priceH - PAD_T - PAD_B);
    const yVol = (v: number) =>
      priceH + 10 + (1 - v / maxVol) * (volH - PAD_B);

    // Four horizontal gridlines with price labels.
    const grid = Array.from({ length: 5 }, (_, i) => {
      const price = min + (range / 4) * i;
      return { price, y: yPrice(price) };
    });

    const bars = candles.map((c, i) => {
      const cx = i * slot + slot / 2;
      const up = c.close >= c.open;
      const yHigh = yPrice(c.high);
      const yLow = yPrice(c.low);
      const yOpen = yPrice(c.open);
      const yClose = yPrice(c.close);
      return {
        key: `${c.date}-${i}`,
        up,
        cx,
        yHigh,
        yLow,
        bodyY: Math.min(yOpen, yClose),
        bodyH: Math.max(1, Math.abs(yClose - yOpen)),
        bodyW,
        volY: yVol(c.volume),
        volH: priceH + volH - yVol(c.volume),
      };
    });

    return { w, priceH, volH, slot, plotW, grid, bars, max, min };
  }, [candles, height]);

  if (!layout) {
    return (
      <div className="state-block" role="status">
        No price history for this ticker.
      </div>
    );
  }

  const { w, priceH, volH, grid, bars, slot } = layout;

  return (
    <svg
      ref={svgRef}
      className="candle-chart candle-chart-pan"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Candlestick chart, ${candles.length} sessions`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setView(null)}
    >
      {/* Price gridlines with labels on the right, terminal-style. */}
      {grid.map((g) => (
        <g key={g.price}>
          <line x1={0} x2={w - PAD_R} y1={g.y} y2={g.y} className="chart-grid" />
          <text x={w - PAD_R + 6} y={g.y + 3} className="chart-axis-label">
            {g.price.toFixed(0)}
          </text>
        </g>
      ))}

      {/* Divider between price and volume panes. */}
      <line
        x1={0}
        x2={w - PAD_R}
        y1={priceH + 6}
        y2={priceH + 6}
        className="chart-grid"
      />

      {bars.map((b) => (
        <g key={b.key}>
          <line
            x1={b.cx}
            x2={b.cx}
            y1={b.yHigh}
            y2={b.yLow}
            className={b.up ? "candle-wick-up" : "candle-wick-down"}
          />
          <rect
            x={b.cx - b.bodyW / 2}
            y={b.bodyY}
            width={b.bodyW}
            height={b.bodyH}
            className={b.up ? "candle-body-up" : "candle-body-down"}
          />
          <rect
            x={b.cx - b.bodyW / 2}
            y={b.volY}
            width={b.bodyW}
            height={Math.max(0.5, b.volH)}
            className={b.up ? "candle-vol-up" : "candle-vol-down"}
          />
        </g>
      ))}

      {/* First/last date labels. */}
      <text x={2} y={height - 1} className="chart-axis-label">
        {candles[0]?.date}
      </text>
      <text x={w - PAD_R - 2} y={height - 1} className="chart-axis-label" textAnchor="end">
        {candles[candles.length - 1]?.date}
      </text>

      {/* Volume pane baseline. */}
      <line
        x1={0}
        x2={w - PAD_R}
        y1={priceH + volH}
        y2={priceH + volH}
        className="chart-grid"
      />
      <text x={w - PAD_R + 6} y={priceH + 26} className="chart-axis-label">
        VOL
      </text>
      <text x={w - PAD_R + 6} y={priceH + volH} className="chart-axis-label">
        {Math.round(layout.max - layout.min)}
      </text>

      {/* Keep slot referenced so a lone candle still lays out sensibly. */}
      <rect x={0} y={0} width={slot * 0} height={0} fill="none" />
    </svg>
  );
}

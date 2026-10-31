import type { TickerRow } from "../types";

/**
 * Which metrics the detail panel's STRUCTURE section shows.
 *
 * Scope is deliberately narrow: this controls the STRUCTURE section only.
 * FLOW and INTENSITY are separate sections with their own fixed fields and are
 * not affected by this setting.
 */
export interface StructureMetric {
  key: string;
  label: string;
  /** How many decimals to render; null means "pass through as text". */
  dp: number | null;
  title: string;
  read: (row: TickerRow) => number | string | null;
}

/** Every metric the STRUCTURE section can display. */
export const STRUCTURE_METRICS: readonly StructureMetric[] = [
  {
    key: "ma5",
    label: "MA5",
    dp: 2,
    title: "5-period moving average",
    read: (r) => r.ma5,
  },
  {
    key: "ma13",
    label: "MA13",
    dp: 2,
    title: "13-period moving average",
    read: (r) => r.ma13,
  },
  {
    key: "ma34",
    label: "MA34",
    dp: 2,
    title: "34-period moving average",
    read: (r) => r.ma34,
  },
  {
    key: "ma200",
    label: "MA200",
    dp: 2,
    title: "200-period moving average",
    read: (r) => r.ma200,
  },
  {
    key: "rsi14",
    label: "RSI14",
    dp: 1,
    title: "Relative strength index, 14 periods",
    read: (r) => r.rsi14,
  },
  {
    key: "ma_structure",
    label: "MA STRUCT",
    dp: null,
    title: "Moving-average structure classification",
    read: (r) => r.ma_structure,
  },
  {
    key: "vwap_sm",
    label: "VWAP SM",
    dp: 2,
    title: "Volume-weighted average price, smart money side",
    read: (r) => r.vwap_sm,
  },
  {
    key: "vwap_bm",
    label: "VWAP BM",
    dp: 2,
    title: "Volume-weighted average price, bad money side",
    read: (r) => r.vwap_bm,
  },
  {
    key: "atr_pct",
    label: "ATR%",
    dp: 2,
    title: "Average true range as a percentage of price",
    read: (r) => r.atr_pct,
  },
  {
    key: "volx_gap",
    label: "VOLX GAP",
    dp: 2,
    title: "Volume expansion gap",
    read: (r) => r.volx_gap,
  },
  {
    key: "cm_streak",
    label: "CM STREAK",
    dp: 0,
    title: "Consecutive clean-money streak, days",
    read: (r) => r.cm_streak,
  },
] as const;

/** Metric keys shown when the user has never opened the settings. */
export const DEFAULT_STRUCTURE_KEYS: readonly string[] = [
  "ma5",
  "ma13",
  "ma34",
  "ma200",
  "rsi14",
  "ma_structure",
  "vwap_sm",
  "vwap_bm",
] as const;

const BY_KEY = new Map<string, StructureMetric>(STRUCTURE_METRICS.map((m) => [m.key, m]));

export function structureMetric(key: string): StructureMetric | undefined {
  return BY_KEY.get(key);
}

/**
 * Normalise a persisted selection.
 *
 * Unknown keys are dropped (so a metric removed from the code does not linger
 * in storage), and an empty selection falls back to the default rather than
 * rendering a blank section.
 */
export function normaliseStructureKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    if (!BY_KEY.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.length > 0 ? out : [...DEFAULT_STRUCTURE_KEYS];
}

/** One searchable field the settings menu can offer, for the filter box. */
export function searchableMetrics(query: string): StructureMetric[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...STRUCTURE_METRICS];
  return STRUCTURE_METRICS.filter(
    (m) => m.label.toLowerCase().includes(q) || m.title.toLowerCase().includes(q),
  );
}

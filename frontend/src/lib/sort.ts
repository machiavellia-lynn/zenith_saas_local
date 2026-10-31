import type { TickerRow } from "../types";

/** Columns the table can sort by. */
export type SortKey =
  | "ticker"
  | "price"
  | "gain_pct"
  | "sm_val"
  | "bm_val"
  | "clean_money"
  | "rsm"
  | "sri"
  | "tx"
  | "phase"
  | "action";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * The table's default order matches the backend's own ordering
 * (routes_flow.py sorts by clean_money descending), so the mock view and the
 * live view agree on first paint. PRD US-009 / FR-8.
 */
export const DEFAULT_SORT: SortState = { key: "clean_money", dir: "desc" };

/** Columns whose values are numeric (or nullable-numeric). */
const NUMERIC_KEYS: ReadonlySet<SortKey> = new Set<SortKey>([
  "price",
  "gain_pct",
  "sm_val",
  "bm_val",
  "clean_money",
  "rsm",
  "sri",
  "tx",
]);

type SortValue = number | string | null;

function valueFor(row: TickerRow, key: SortKey): SortValue {
  switch (key) {
    case "ticker":
      return row.ticker;
    case "phase":
      return row.phase;
    case "action":
      return row.action;
    default:
      return row[key];
  }
}

/**
 * Compare two rows for a given sort.
 *
 * Nulls always sort last, in BOTH directions — a missing metric is "no
 * information", and burying it either way is more useful than letting it
 * occupy the top of a descending sort. PRD US-010.
 */
export function compareRows(a: TickerRow, b: TickerRow, sort: SortState): number {
  const av = valueFor(a, sort.key);
  const bv = valueFor(b, sort.key);

  const aNull = av === null || av === undefined;
  const bNull = bv === null || bv === undefined;

  if (aNull && bNull) return tieBreak(a, b);
  if (aNull) return 1;
  if (bNull) return -1;

  const dir = sort.dir === "asc" ? 1 : -1;

  if (NUMERIC_KEYS.has(sort.key)) {
    const an = av as number;
    const bn = bv as number;
    if (an !== bn) return an < bn ? -dir : dir;
    return tieBreak(a, b);
  }

  const as = String(av);
  const bs = String(bv);
  const cmp = as.localeCompare(bs, "en", { sensitivity: "base" });
  if (cmp !== 0) return cmp * dir;
  return tieBreak(a, b);
}

/**
 * Stable, deterministic fallback so equal values do not reorder between
 * renders. Ticker ascending is arbitrary but consistent.
 */
function tieBreak(a: TickerRow, b: TickerRow): number {
  return a.ticker.localeCompare(b.ticker, "en");
}

/** Sort a copy of the rows; never mutates the input. */
export function sortRows(rows: readonly TickerRow[], sort: SortState): TickerRow[] {
  return [...rows].sort((a, b) => compareRows(a, b, sort));
}

/**
 * Next sort state when a header is clicked:
 * same column toggles direction, a new column starts at its natural direction.
 * Numeric columns read best descending-first; text columns ascending-first.
 */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: NUMERIC_KEYS.has(key) ? "desc" : "asc" };
}

/** The default direction a column uses when first clicked. */
export function defaultDirFor(key: SortKey): SortDir {
  return NUMERIC_KEYS.has(key) ? "desc" : "asc";
}

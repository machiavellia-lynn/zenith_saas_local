/**
 * Types for the non-flow pages. Same discipline as ../types.ts: these mirror
 * the reference app's API responses field-for-field so mock data can later be
 * swapped for real fetches.
 *
 * Source: D:\zenith_saas\routes\ (READ-ONLY reference)
 *   routes_sector.py  -> SectorResponse
 *   routes_bsjp.py    -> BsjpSignalsResponse
 */

/* ── Sector rotation ─────────────────────────────────────────────────── */

/** One sector row from GET /api/sector. Monetary fields in Juta. */
export interface SectorRow {
  name: string;
  sm_val: number;
  bm_val: number;
  cm: number;
  mf_plus: number | null;
  mf_minus: number | null;
  net_mf: number | null;
  gain_pct: number | null;
  ticker_count: number;
}

export interface SectorResponse {
  sectors: SectorRow[];
  date_from: string;
  date_to: string;
}

/* ── BSJP scanner ───────────────────────────────────────────────────── */

/**
 * Setup identifiers. Only the two enabled in `config.BSJP_ENABLED_SETUPS`
 * may appear; the reference keeps the others defined but gated off, so they
 * are listed here to make the closed set explicit and to let the UI label
 * them if they ever appear.
 */
export type BsjpSetup =
  | "SMA5_BREAKOUT_V13"
  | "POWER_BREAK_V21";

export const BSJP_SETUPS: readonly BsjpSetup[] = [
  "SMA5_BREAKOUT_V13",
  "POWER_BREAK_V21",
] as const;

/** One row from the `bsjp_signals` table (GET /api/bsjp/signals). */
export interface BsjpSignal {
  id: number;
  /** DD-MM-YYYY */
  date: string;
  ticker: string;
  setup: BsjpSetup;
  entry: number | null;
  tp1: number | null;
  tp2: number | null;
  sl: number | null;
  sl_type: string | null;
  score: number | null;
  day_rank: number | null;
  lot_size: number | null;
  universe: string;
  computed_at: string | null;
}

export interface BsjpSignalsResponse {
  date: string;
  count: number;
  signals: BsjpSignal[];
}

/* ── Chart / OHLCV ──────────────────────────────────────────────────── */

/** One daily candle. */
export interface Candle {
  /** YYYY-MM-DD (chart uses internal storage format). */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleSeries {
  ticker: string;
  tf: string;
  points: Candle[];
}

/* ── Portfolio simulation ───────────────────────────────────────────── */

export type TradeSide = "LONG";

export interface PortfolioTrade {
  id: number;
  ticker: string;
  setup: string;
  /** DD-MM-YYYY */
  entry_date: string;
  exit_date: string | null;
  entry: number;
  exit: number | null;
  lots: number;
  pnl: number | null;
  pnl_pct: number | null;
  status: "OPEN" | "CLOSED";
  phase: string | null;
}

export interface EquityPoint {
  /** DD-MM-YYYY */
  date: string;
  equity: number;
  drawdown_pct: number;
}

export interface PortfolioSummary {
  starting_capital: number;
  equity: number;
  total_pnl: number;
  total_pnl_pct: number;
  /**
   * Realised win rate as a PERCENTAGE (0–100), matching the reference backend
   * (algo_portfolio.py emits `round(wins / closed * 100, 2)`).
   * Render with formatPct directly — do NOT multiply by 100 again.
   */
  win_rate: number;
  /** Total trade rows, including OPEN ones. */
  trades: number;
  /** Realised wins only, so `wins + losses === trades - openTrades`. */
  wins: number;
  losses: number;
  max_drawdown_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  profit_factor: number | null;
  expectancy_pct: number | null;
}

export interface PortfolioResponse {
  summary: PortfolioSummary;
  equity_curve: EquityPoint[];
  trades: PortfolioTrade[];
  date_from: string;
  date_to: string;
}

/* ── Admin ──────────────────────────────────────────────────────────── */

export type JobStatus = "idle" | "running" | "ok" | "failed";

export interface AdminJob {
  key: string;
  name: string;
  description: string;
  schedule: string;
  status: JobStatus;
  last_run: string | null;
  last_result: string | null;
  rows: number | null;
}

export interface AdminResponse {
  jobs: AdminJob[];
  counts: { eod_summary: number; raw_messages: number; bsjp_signals: number; tickers: number };
  universe: string;
  last_ingest: string | null;
}

/* ── Market snapshot (hub) ──────────────────────────────────────────── */

export interface MarketSnapshot {
  /** Null when the index quote could not be fetched. */
  ihsg: number | null;
  ihsg_gain_pct: number | null;
  /** YYYY-MM-DD */
  as_of: string;
  time: string;
  status: "OPEN" | "CLOSED" | "PRE_OPEN";
}

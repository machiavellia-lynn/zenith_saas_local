/**
 * Static mock of `GET /api/bsjp/signals`.
 *
 * Field-for-field shape comes from the reference backend:
 *   D:\zenith_saas\routes\routes_bsjp.py   L22-41    (READ-ONLY)
 *   D:\zenith_saas\algo\algo_bsjp.py       L130-190
 *
 * Mirrored from those files:
 *  - Only `config.BSJP_ENABLED_SETUPS` sets may appear here: `SMA5_BREAKOUT_V13`
 *    and `POWER_BREAK_V21` (config.py L129). `types.pages.ts` already pins that
 *    closed set as `BsjpSetup`.
 *  - Prices are whole rupiah on a valid IDX tick. `_to_tick` (algo_bsjp.py
 *    L40-50) rounds to 1 below 200, 2 below 500, 5 below 5,000 and 25 above,
 *    so every price here is tick-aligned.
 *  - Both enabled setups use `FIXED_2PCT` (algo_bsjp.py L131-134), and SL_MAP
 *    is the only source `sl_type` can come from — hence the exported closed set
 *    below rather than free-text strings.
 *  - `sl < entry < tp1 < tp2` is structural for this strategy: entry is the
 *    close, TP1 = +1%, TP2 = +2%, SL = −2% (algo_bsjp.py L164-166), all at the
 *    same tick. The tests assert the strict ordering on every row.
 *  - `day_rank` ranks the TOP_N slice, 1-based and ascending
 *    (routes_bsjp.py L32 orders by it).
 *  - `lot_size` is the IDX lot (100 shares, config.PF_LOT_SIZE) and `score` is
 *    the composite from `_compute_score` (algo_bsjp.py), which blends five
 *    normalised terms by fixed weights and therefore lands in [0, 1].
 *  - Dates are DD-MM-YYYY; `computed_at` is the scan's stamp.
 *
 * Literal rows, ordered by `day_rank` — the ranking the UI shows is the
 * ranking the tests read.
 */

import type { BsjpSetup, BsjpSignal, BsjpSignalsResponse } from "../types.pages";
import { BSJP_SETUPS } from "../types.pages";

/** The day the scan ran, DD-MM-YYYY. */
const SCAN_DATE = "02-10-2026";

/**
 * Stamp written when the scan produced these rows.
 *
 * 17:05 WIB (UTC+7) is just after the IDX close and its post-close auction, so
 * the EOD summary the scanner reads is already complete.
 */
const COMPUTED_AT = "2026-10-02T17:05:13+07:00";

/**
 * The closed set of `sl_type` values (algo_bsjp.py L130-136).
 *
 * Both enabled setups map to `FIXED_2PCT`; `MA5` and `BB_MID` belong to setups
 * the reference defines but leaves gated off. They are listed so the UI has a
 * label for any of them if the enabled set is ever widened.
 */
export const BSJP_SL_TYPES = ["FIXED_2PCT", "MA5", "BB_MID"] as const;

export type BsjpSlType = (typeof BSJP_SL_TYPES)[number];

/** The `universe` value this book was ranked over. */
export const BSJP_UNIVERSE = "full";

/** IDX lot size: 1 lot = 100 shares (config.PF_LOT_SIZE). */
const LOT_SIZE = 100;

/** Fractions of entry used to derive the bracket, from algo_bsjp.py L164-166. */
const TP1_FRACTION = 1.01;
const TP2_FRACTION = 1.02;
const SL_FRACTION = 0.98;

interface Spec {
  ticker: string;
  setup: BsjpSetup;
  /** Reference close, whole rupiah, tick-aligned. */
  close: number;
  score: number;
  slType: BsjpSlType;
}

/**
 * Ranked candidates for the session.
 *
 * Fourteen names across the TOP_N slice the reference backtest sizes at five
 * slots — the mock shows a fuller slice so the scanner table has enough rows to
 * sort and scroll without repeating tickers.
 */
const SPECS: readonly Spec[] = [
  { ticker: "BRPT", setup: "POWER_BREAK_V21", close: 1_065, score: 0.8421, slType: "FIXED_2PCT" },
  { ticker: "ARTO", setup: "SMA5_BREAKOUT_V13", close: 2_540, score: 0.8174, slType: "FIXED_2PCT" },
  { ticker: "BBRI", setup: "POWER_BREAK_V21", close: 4_520, score: 0.8035, slType: "FIXED_2PCT" },
  { ticker: "ANTM", setup: "SMA5_BREAKOUT_V13", close: 1_645, score: 0.7892, slType: "FIXED_2PCT" },
  { ticker: "BBRI", setup: "SMA5_BREAKOUT_V13", close: 4_515, score: 0.7768, slType: "FIXED_2PCT" },
  { ticker: "MTEL", setup: "POWER_BREAK_V21", close: 655, score: 0.7613, slType: "FIXED_2PCT" },
  { ticker: "BBCA", setup: "POWER_BREAK_V21", close: 9_875, score: 0.7486, slType: "FIXED_2PCT" },
  { ticker: "BRIS", setup: "SMA5_BREAKOUT_V13", close: 2_890, score: 0.7329, slType: "FIXED_2PCT" },
  { ticker: "CTRA", setup: "POWER_BREAK_V21", close: 1_185, score: 0.7145, slType: "FIXED_2PCT" },
  { ticker: "ADHI", setup: "SMA5_BREAKOUT_V13", close: 272, score: 0.7012, slType: "FIXED_2PCT" },
  { ticker: "TLKM", setup: "POWER_BREAK_V21", close: 3_140, score: 0.6874, slType: "FIXED_2PCT" },
  { ticker: "BBNI", setup: "SMA5_BREAKOUT_V13", close: 4_980, score: 0.6708, slType: "FIXED_2PCT" },
  { ticker: "ERAA", setup: "POWER_BREAK_V21", close: 402, score: 0.6531, slType: "FIXED_2PCT" },
  { ticker: "SMRA", setup: "SMA5_BREAKOUT_V13", close: 615, score: 0.6394, slType: "FIXED_2PCT" },
];

/**
 * The IDX price fraction (fraksi harga) for a level, from algo_bsjp.py L40-50.
 *
 * Prices are quoted on a coarser grid as they get larger: Rp1 under 200, Rp2
 * under 500, Rp5 under 5,000, Rp25 above.
 */
function tickSize(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 5_000) return 5;
  return 25;
}

/** Snap a level to the IDX tick grid, as `_to_tick` does (algo_bsjp.py L50). */
function toTick(price: number): number {
  const tick = tickSize(price);
  return Math.round(price / tick) * tick;
}

/** Restrict a float to [0, 1]; the five weighted score terms cannot exceed it. */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Build one signal, deriving the bracket the way `signal_detail` does.
 *
 * Ordering is guaranteed by construction here — TP1/TP2 are fractions above
 * entry and SL a fraction below — but the prices still land on the IDX tick
 * grid, which is why they are snapped rather than left fractional. For the
 * smallest names (ERAA at Rp402, ADHI at Rp272) a 1% move rounds to a whole
 * tick or two, exactly as `_to_tick` would.
 */
function buildSignal(s: Spec, index: number): BsjpSignal {
  const entry = toTick(s.close);

  return {
    id: 8_600 + index * 7,
    date: SCAN_DATE,
    ticker: s.ticker,
    setup: s.setup,
    entry,
    tp1: toTick(entry * TP1_FRACTION),
    tp2: toTick(entry * TP2_FRACTION),
    sl: toTick(entry * SL_FRACTION),
    sl_type: s.slType,
    score: clamp01(s.score),
    day_rank: index + 1,
    lot_size: LOT_SIZE,
    universe: BSJP_UNIVERSE,
    computed_at: COMPUTED_AT,
  };
}

const signals: BsjpSignal[] = SPECS.map(buildSignal);

// The enabled-set guard runs at module load: a setup outside
// `BSJP_ENABLED_SETUPS` would be a row the live scanner could never emit.
const enabled = new Set<string>(BSJP_SETUPS);
for (const sig of signals) {
  if (!enabled.has(sig.setup)) {
    throw new Error(`mockBsjp: setup ${sig.setup} is not an enabled BSJP setup`);
  }
}

// One ticker can appear twice (two setups firing the same day) but never twice
// for the same setup — the backend's uniqueness is on (date, ticker, setup).
const pairs = new Set<string>();
for (const sig of signals) {
  const key = `${sig.ticker}|${sig.setup}`;
  if (pairs.has(key)) {
    throw new Error(`mockBsjp: duplicate signal for ${key}`);
  }
  pairs.add(key);
}

/**
 * Ranked book for the scan date, shaped like `GET /api/bsjp/signals`.
 *
 * `count` is folded from `signals` (routes_bsjp.py L41 sends `len(rows)`), so
 * the header total can never drift from the rows beneath it.
 */
export const mockBsjp: BsjpSignalsResponse = {
  date: SCAN_DATE,
  count: signals.length,
  signals,
};

/** Tickers the scanner flagged, in rank order. Exported for reuse in tests. */
export const mockBsjpTickers: readonly string[] = SPECS.map((s) => s.ticker);

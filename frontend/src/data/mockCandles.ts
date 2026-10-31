/**
 * Static mock of the chart endpoint that feeds the OHLCV panel.
 *
 * The reference serves candles from `price_history` / `ohlcv_daily`; only the
 * response *shape* is mirrored here, from `types.pages.ts` (`CandleSeries`).
 *
 * Generation, not literals
 * ------------------------
 * Six series × ~180 sessions is far too much to hand-write, and hand-written
 * rows drift: the high of one session is the open of the next, so a typo in any
 * single literal silently breaks the chart. These are generated instead from a
 * **seeded LCG** — deterministic and reproducible, so the file renders the same
 * series on every machine and every build, with no `Math.random`.
 *
 * Invariants the generator guarantees structurally, and the tests re-check on
 * every candle:
 *  - `low <= min(open, close)` and `high >= max(open, close)`.
 *  - `volume > 0`.
 *  - Dates strictly ascending, weekends skipped, `YYYY-MM-DD`.
 *
 * The walk is a random-ish drift around a per-ticker anchor, not a real price
 * model: it exists to give the chart plausible candles, not to be tradeable.
 */

import type { Candle, CandleSeries } from "../types.pages";

/** Daily timeframe — the only one the terminal requests today. */
export const CANDLE_TIMEFRAMES = ["1D"] as const;

/** One of the timeframes the mock actually carries. */
export type CandleTimeframe = (typeof CANDLE_TIMEFRAMES)[number];

/** Sessions generated per series. Well past the 60 the chart needs to draw. */
export const CANDLE_SESSIONS = 180;

/** Most recent session in the generated window. A Friday. */
const END_DATE = "2026-10-02";

/** Seed of the LCG, mixed with a per-ticker hash so series differ. */
const BASE_SEED = 0x2f6e2b1;

interface SeriesSpec {
  ticker: string;
  /** Opening level of the walk, in whole rupiah. */
  anchor: number;
  /** Daily volatility as a fraction of price (IDX blue chips: 1–3%). */
  vol: number;
  /** Per-session drift in [−1, 1]; positive is an uptrend. */
  drift: number;
  /** Baseline shares traded; volume wanders around it. */
  baseVolume: number;
}

/**
 * The six series the chart is designed against.
 *
 * BBRI is required by the PRD; the rest cover the price bands the terminal
 * table spans, from a Rp138 coal name to a Rp9,875 bank, so the y-axis, the
 * tick formatter and the volume bars all meet realistic inputs.
 */
const SPECS: readonly SeriesSpec[] = [
  { ticker: "BBRI", anchor: 4_180, vol: 0.0142, drift: 0.16, baseVolume: 268_400_000 },
  { ticker: "BBCA", anchor: 9_320, vol: 0.0098, drift: 0.11, baseVolume: 92_600_000 },
  { ticker: "BMRI", anchor: 5_760, vol: 0.0131, drift: 0.09, baseVolume: 141_800_000 },
  { ticker: "TLKM", anchor: 3_320, vol: 0.0118, drift: -0.07, baseVolume: 118_200_000 },
  { ticker: "ANTM", anchor: 1_420, vol: 0.0212, drift: 0.21, baseVolume: 205_900_000 },
  { ticker: "GOTO", anchor: 64, vol: 0.0264, drift: -0.18, baseVolume: 3_884_000_000 },
  { ticker: "ASII", anchor: 4_740, vol: 0.0124, drift: 0.04, baseVolume: 76_500_000 },
  { ticker: "BUMI", anchor: 132, vol: 0.0318, drift: 0.13, baseVolume: 5_126_000_000 },
];

/**
 * A 32-bit linear congruential generator (Numerical Recipes constants).
 *
 * Chosen because it is short enough to audit, has no dependency, and produces
 * the same stream everywhere — the reproducibility the mock depends on. `next`
 * returns [0, 1).
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Stable hash of a ticker, so a series' stream is tied to its symbol. */
function seedFor(ticker: string): number {
  let h = BASE_SEED;
  for (let i = 0; i < ticker.length; i += 1) {
    h = (Math.imul(h, 31) + ticker.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * The `count` most recent weekdays ending at `end`.
 *
 * Weekends are skipped because IDX does not trade them; the exchange holidays
 * are not modelled, which is fine for a chart mock. Returned oldest-first.
 */
function sessionDates(end: string, count: number): string[] {
  const [y = "0", m = "0", d = "0"] = end.split("-");
  const cursor = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const dates: string[] = [];

  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      const yy = cursor.getUTCFullYear();
      const mm = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(cursor.getUTCDate()).padStart(2, "0");
      dates.push(`${yy}-${mm}-${dd}`);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return dates.reverse();
}

/**
 * Snap a price to the IDX tick grid.
 *
 * The chart is drawn from these levels and the tooltip prints them as whole
 * rupiah, so they are snapped the same way `algo_bsjp._to_tick` snaps them.
 */
function toTick(price: number): number {
  const tick = price < 200 ? 1 : price < 500 ? 2 : price < 5_000 ? 5 : 25;
  return Math.max(tick, Math.round(price / tick) * tick);
}

/**
 * Walk one series forward from its anchor.
 *
 * The close moves by a random step; the open is the previous close nudged by a
 * gap; the wicks are drawn from the intrabar range, which can only widen the
 * candle. Building `high`/`low` outward from the body like this is what makes
 * `low <= min(open, close) <= max(open, close) <= high` true by construction
 * rather than by luck.
 */
function buildSeries(spec: SeriesSpec): CandleSeries {
  const rand = lcg(seedFor(spec.ticker));
  const dates = sessionDates(END_DATE, CANDLE_SESSIONS);
  const points: Candle[] = [];

  let close = toTick(spec.anchor);

  for (const date of dates) {
    const open = toTick(close * (1 + (rand() - 0.5) * spec.vol * 0.6));
    const step = (rand() - 0.5) * 2 * spec.vol + spec.drift * spec.vol * 0.08;
    const nextClose = toTick(open * (1 + step));

    // Body first, then wicks that extend it — never truncate the body.
    const body = Math.max(open, nextClose);
    const foot = Math.min(open, nextClose);
    const spread = (body * spec.vol * (0.35 + rand() * 0.9)) / 2;
    const high = toTick(body + spread);
    const low = toTick(Math.max(1, foot - spread));

    const volume = Math.round(spec.baseVolume * (0.55 + rand() * 0.95));

    points.push({ date, open, high, low, close: nextClose, volume });
    close = nextClose;
  }

  return { ticker: spec.ticker, tf: "1D", points };
}

/**
 * Every generated series, keyed by ticker.
 *
 * Built once at module load and frozen: the chart must be able to index it
 * synchronously, and a mutating caller should not be able to corrupt the
 * dataset another panel is reading.
 */
export const mockCandles: Record<string, CandleSeries> = Object.freeze(
  Object.fromEntries(SPECS.map((s) => [s.ticker, buildSeries(s)])),
);

/**
 * An empty series for a ticker (or timeframe) the mock does not carry.
 *
 * Mirrors `emptyTransactions` in `types.ts`: the chart always gets a defined
 * shape to render — never `undefined`, and never a throw — so an unknown
 * ticker falls through to the panel's empty state instead of crashing it.
 */
export function emptyCandles(ticker: string, tf: string): CandleSeries {
  return { ticker, tf, points: [] };
}

/** Read one series, falling back to an empty series rather than undefined. */
export function getCandles(ticker: string, tf: string): CandleSeries {
  const series = mockCandles[ticker];
  if (series === undefined) return emptyCandles(ticker, tf);

  // The mock only carries one timeframe; anything else is a miss, not a
  // silently mislabelled daily series.
  if (series.tf !== tf) return emptyCandles(ticker, tf);

  return series;
}

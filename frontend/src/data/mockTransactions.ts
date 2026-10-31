/**
 * Static mock of `GET /api/transactions` (PRD US-005).
 *
 * Field-for-field shape comes from the reference backend:
 *   D:\zenith_saas\routes\routes_flow.py  L289-336   (READ-ONLY)
 *
 * Mirrored from that file:
 *  - The response splits rows into `sm` and `bm` tapes by channel (L321-333).
 *  - `date` is DD-MM-YYYY; `time` is HH:MM:SS within the IDX session.
 *  - `mf` is the raw MF-delta string as received, `mf_num` its numeric twin
 *    (L328-329) — hence the `+21.4B` / `mf_num: 21400` pairing below.
 *  - `price` is whole rupiah (L326 rounds it).
 */

import type { TransactionRow, TransactionsResponse } from "../types";
import { emptyTransactions } from "../types";

/**
 * The closed set of `signal` values.
 *
 * Single source of truth so signal literals are never scattered across
 * components (PRD US-005). These are the strength tiers the upstream Telegram
 * parser attaches to a flow message.
 */
export const SIGNALS = ["SUPER BIG", "BIG", "MEDIUM", "SMALL", "RETAIL"] as const;

export type Signal = (typeof SIGNALS)[number];

/** Days covered by the tape, DD-MM-YYYY. Most recent first. */
const TAPE_DATES = ["02-10-2026", "01-10-2026", "30-09-2026"] as const;

interface Seed {
  /** Session time, HH:MM:SS WIB. */
  time: string;
  price: number;
  gain: number;
  /** Signed MF delta in Juta. */
  mf: number;
  vol_x: number;
  signal: Signal;
}

interface TapeSpec {
  sm: readonly Seed[];
  bm: readonly Seed[];
}

/** Format a Juta delta the way the upstream message renders it: +21.4B / -1.2M. */
function mfRaw(juta: number): string {
  const abs = Math.abs(juta);
  const sign = juta >= 0 ? "+" : "-";
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}B`;
  return `${sign}${abs.toFixed(1)}M`;
}

/** Build one tape row, keeping `mf` and `mf_num` in step. */
function row(date: string, seed: Seed): TransactionRow {
  return {
    date,
    time: seed.time,
    price: seed.price,
    gain_pct: seed.gain,
    mf: mfRaw(seed.mf),
    mf_num: seed.mf,
    vol_x: seed.vol_x,
    signal: seed.signal,
  };
}

/**
 * Expand a tape across the covered days.
 *
 * Day 0 is the full session; later days carry a shorter, thinner tape, which
 * is what a multi-day range request actually returns.
 */
function expand(spec: TapeSpec): { sm: TransactionRow[]; bm: TransactionRow[] } {
  const sm: TransactionRow[] = [];
  const bm: TransactionRow[] = [];

  TAPE_DATES.forEach((date, dayIndex) => {
    const keep = dayIndex === 0 ? spec.sm.length : Math.max(5, spec.sm.length - dayIndex * 3);
    spec.sm.slice(0, keep).forEach((seed) => sm.push(row(date, seed)));

    const keepBm = dayIndex === 0 ? spec.bm.length : Math.max(5, spec.bm.length - dayIndex * 3);
    spec.bm.slice(0, keepBm).forEach((seed) => bm.push(row(date, seed)));
  });

  return { sm, bm };
}

function build(ticker: string, spec: TapeSpec): TransactionsResponse {
  const { sm, bm } = expand(spec);
  return { ticker, sm, bm, sm_count: sm.length, bm_count: bm.length };
}

/** BBCA — a textbook accumulation day: SM builds all session, BM fades. */
const BBCA: TapeSpec = {
  sm: [
    { time: "09:14:22", price: 9_725, gain: 0.32, mf: 21_400, vol_x: 3.42, signal: "SUPER BIG" },
    { time: "09:31:07", price: 9_775, gain: 0.45, mf: 14_820, vol_x: 2.88, signal: "BIG" },
    { time: "09:58:41", price: 9_750, gain: 0.28, mf: 8_940, vol_x: 1.94, signal: "MEDIUM" },
    { time: "10:22:15", price: 9_810, gain: 0.62, mf: 18_660, vol_x: 3.11, signal: "SUPER BIG" },
    { time: "10:47:53", price: 9_840, gain: 0.79, mf: 11_230, vol_x: 2.27, signal: "BIG" },
    { time: "11:13:36", price: 9_795, gain: 0.51, mf: 4_870, vol_x: 1.38, signal: "MEDIUM" },
    { time: "11:41:09", price: 9_860, gain: 0.91, mf: 16_450, vol_x: 2.96, signal: "BIG" },
    { time: "13:29:44", price: 9_885, gain: 0.68, mf: 9_610, vol_x: 1.72, signal: "MEDIUM" },
    { time: "14:02:18", price: 9_910, gain: 0.84, mf: 23_780, vol_x: 3.68, signal: "SUPER BIG" },
    { time: "14:36:52", price: 9_900, gain: 0.75, mf: 6_930, vol_x: 1.51, signal: "SMALL" },
    { time: "15:07:31", price: 9_935, gain: 1.02, mf: 13_540, vol_x: 2.14, signal: "BIG" },
    { time: "15:41:26", price: 9_875, gain: 0.82, mf: 19_220, vol_x: 2.83, signal: "SUPER BIG" },
    { time: "15:52:03", price: 9_870, gain: 0.79, mf: 7_480, vol_x: 1.63, signal: "MEDIUM" },
  ],
  bm: [
    { time: "09:26:38", price: 9_760, gain: 0.41, mf: -12_340, vol_x: 1.86, signal: "BIG" },
    { time: "09:51:12", price: 9_745, gain: 0.26, mf: -6_780, vol_x: 1.42, signal: "MEDIUM" },
    { time: "10:18:47", price: 9_800, gain: 0.57, mf: -9_450, vol_x: 1.68, signal: "MEDIUM" },
    { time: "10:49:05", price: 9_835, gain: 0.74, mf: -15_220, vol_x: 2.31, signal: "BIG" },
    { time: "11:27:29", price: 9_790, gain: 0.46, mf: -3_180, vol_x: 0.94, signal: "SMALL" },
    { time: "13:44:16", price: 9_890, gain: 0.72, mf: -8_640, vol_x: 1.57, signal: "MEDIUM" },
    { time: "14:19:58", price: 9_905, gain: 0.81, mf: -21_760, vol_x: 2.74, signal: "SUPER BIG" },
    { time: "14:55:37", price: 9_915, gain: 0.87, mf: -5_290, vol_x: 1.31, signal: "SMALL" },
    { time: "15:22:44", price: 9_920, gain: 0.9, mf: -11_880, vol_x: 1.93, signal: "BIG" },
    { time: "15:48:11", price: 9_872, gain: 0.8, mf: -7_950, vol_x: 1.48, signal: "MEDIUM" },
    { time: "15:56:29", price: 9_868, gain: 0.77, mf: -2_410, vol_x: 0.87, signal: "SMALL" },
    { time: "15:59:47", price: 9_875, gain: 0.83, mf: -4_070, vol_x: 1.12, signal: "SMALL" },
  ],
};

/** BBRI — heavy two-way flow, SM still dominant but BM fights back late. */
const BBRI: TapeSpec = {
  sm: [
    { time: "09:08:51", price: 4_430, gain: 0.68, mf: 32_150, vol_x: 4.18, signal: "SUPER BIG" },
    { time: "09:36:14", price: 4_470, gain: 1.24, mf: 19_870, vol_x: 3.06, signal: "BIG" },
    { time: "10:04:39", price: 4_450, gain: 0.92, mf: 9_340, vol_x: 1.77, signal: "MEDIUM" },
    { time: "10:33:22", price: 4_490, gain: 1.42, mf: 24_610, vol_x: 3.44, signal: "SUPER BIG" },
    { time: "11:02:47", price: 4_505, gain: 1.58, mf: 12_880, vol_x: 2.19, signal: "BIG" },
    { time: "11:38:05", price: 4_480, gain: 1.11, mf: 5_720, vol_x: 1.34, signal: "MEDIUM" },
    { time: "13:21:56", price: 4_510, gain: 1.69, mf: 17_430, vol_x: 2.72, signal: "BIG" },
    { time: "13:57:33", price: 4_500, gain: 1.46, mf: 8_150, vol_x: 1.61, signal: "MEDIUM" },
    { time: "14:28:41", price: 4_515, gain: 1.8, mf: 28_940, vol_x: 3.87, signal: "SUPER BIG" },
    { time: "14:59:18", price: 4_505, gain: 1.55, mf: 6_480, vol_x: 1.43, signal: "SMALL" },
    { time: "15:26:07", price: 4_520, gain: 1.94, mf: 15_260, vol_x: 2.38, signal: "BIG" },
    { time: "15:47:52", price: 4_515, gain: 1.86, mf: 21_370, vol_x: 2.91, signal: "SUPER BIG" },
    { time: "15:55:14", price: 4_518, gain: 1.91, mf: 9_780, vol_x: 1.69, signal: "MEDIUM" },
  ],
  bm: [
    { time: "09:19:27", price: 4_445, gain: 0.91, mf: -18_640, vol_x: 2.44, signal: "BIG" },
    { time: "09:47:03", price: 4_465, gain: 1.15, mf: -7_920, vol_x: 1.53, signal: "MEDIUM" },
    { time: "10:15:48", price: 4_470, gain: 1.31, mf: -13_570, vol_x: 2.08, signal: "BIG" },
    { time: "10:52:36", price: 4_485, gain: 1.35, mf: -26_310, vol_x: 3.22, signal: "SUPER BIG" },
    { time: "11:24:19", price: 4_495, gain: 1.48, mf: -4_680, vol_x: 1.21, signal: "SMALL" },
    { time: "13:38:52", price: 4_505, gain: 1.62, mf: -10_940, vol_x: 1.82, signal: "MEDIUM" },
    { time: "14:11:07", price: 4_510, gain: 1.71, mf: -22_450, vol_x: 2.87, signal: "SUPER BIG" },
    { time: "14:44:28", price: 4_500, gain: 1.44, mf: -6_130, vol_x: 1.37, signal: "SMALL" },
    { time: "15:14:55", price: 4_518, gain: 1.89, mf: -16_780, vol_x: 2.26, signal: "BIG" },
    { time: "15:39:41", price: 4_512, gain: 1.79, mf: -8_460, vol_x: 1.58, signal: "MEDIUM" },
    { time: "15:53:26", price: 4_516, gain: 1.87, mf: -3_290, vol_x: 1.04, signal: "SMALL" },
    { time: "15:58:39", price: 4_520, gain: 1.95, mf: -11_520, vol_x: 1.88, signal: "BIG" },
  ],
};

/** GOTO — an UPTHRUST: retail chases the pop while BM distributes into it. */
const GOTO: TapeSpec = {
  sm: [
    { time: "09:11:36", price: 70, gain: 0.0, mf: 4_120, vol_x: 1.42, signal: "MEDIUM" },
    { time: "09:42:58", price: 71, gain: 1.43, mf: 6_840, vol_x: 1.86, signal: "MEDIUM" },
    { time: "10:21:44", price: 70, gain: 0.0, mf: 2_310, vol_x: 0.87, signal: "SMALL" },
    { time: "10:58:17", price: 71, gain: 1.43, mf: 9_270, vol_x: 2.14, signal: "BIG" },
    { time: "11:34:29", price: 72, gain: 2.86, mf: 5_480, vol_x: 1.53, signal: "MEDIUM" },
    { time: "13:26:11", price: 71, gain: 1.43, mf: 1_940, vol_x: 0.79, signal: "SMALL" },
    { time: "14:03:47", price: 72, gain: 2.86, mf: 7_630, vol_x: 1.94, signal: "MEDIUM" },
    { time: "14:38:22", price: 73, gain: 4.29, mf: 11_450, vol_x: 2.62, signal: "BIG" },
    { time: "15:06:54", price: 72, gain: 2.86, mf: 3_720, vol_x: 1.18, signal: "SMALL" },
    { time: "15:31:08", price: 72, gain: 2.86, mf: 8_190, vol_x: 1.77, signal: "MEDIUM" },
    { time: "15:49:33", price: 71, gain: 1.43, mf: 4_960, vol_x: 1.36, signal: "MEDIUM" },
    { time: "15:57:52", price: 71, gain: 1.43, mf: 2_080, vol_x: 0.91, signal: "SMALL" },
  ],
  bm: [
    { time: "09:07:19", price: 69, gain: -1.43, mf: -8_740, vol_x: 2.31, signal: "BIG" },
    { time: "09:24:45", price: 70, gain: 0.0, mf: -12_360, vol_x: 2.88, signal: "BIG" },
    { time: "09:53:02", price: 70, gain: 0.0, mf: -5_180, vol_x: 1.44, signal: "MEDIUM" },
    { time: "10:29:37", price: 71, gain: 1.43, mf: -19_850, vol_x: 3.46, signal: "SUPER BIG" },
    { time: "11:08:14", price: 71, gain: 1.43, mf: -7_420, vol_x: 1.68, signal: "MEDIUM" },
    { time: "11:46:51", price: 72, gain: 2.86, mf: -14_930, vol_x: 2.74, signal: "BIG" },
    { time: "13:33:26", price: 72, gain: 2.86, mf: -3_610, vol_x: 1.12, signal: "SMALL" },
    { time: "14:15:39", price: 72, gain: 2.86, mf: -24_170, vol_x: 3.92, signal: "SUPER BIG" },
    { time: "14:49:07", price: 73, gain: 4.29, mf: -9_830, vol_x: 2.06, signal: "MEDIUM" },
    { time: "15:19:28", price: 72, gain: 2.86, mf: -16_240, vol_x: 2.83, signal: "BIG" },
    { time: "15:44:15", price: 71, gain: 1.43, mf: -6_570, vol_x: 1.51, signal: "MEDIUM" },
    { time: "15:59:04", price: 71, gain: 1.43, mf: -11_290, vol_x: 2.19, signal: "BIG" },
  ],
};

/** ANTM — metals momentum, chunky SM prints against a steady BM drip. */
const ANTM: TapeSpec = {
  sm: [
    { time: "09:05:48", price: 1_610, gain: 1.26, mf: 9_870, vol_x: 2.96, signal: "BIG" },
    { time: "09:28:23", price: 1_625, gain: 2.2, mf: 6_240, vol_x: 2.14, signal: "MEDIUM" },
    { time: "09:57:11", price: 1_615, gain: 1.57, mf: 3_480, vol_x: 1.38, signal: "SMALL" },
    { time: "10:26:39", price: 1_635, gain: 2.83, mf: 12_550, vol_x: 3.28, signal: "BIG" },
    { time: "10:54:02", price: 1_640, gain: 3.14, mf: 7_920, vol_x: 2.41, signal: "MEDIUM" },
    { time: "11:22:47", price: 1_630, gain: 2.52, mf: 4_110, vol_x: 1.62, signal: "SMALL" },
    { time: "13:18:35", price: 1_645, gain: 3.46, mf: 15_340, vol_x: 3.74, signal: "SUPER BIG" },
    { time: "13:52:18", price: 1_650, gain: 3.77, mf: 5_630, vol_x: 1.87, signal: "MEDIUM" },
    { time: "14:24:56", price: 1_640, gain: 3.14, mf: 8_940, vol_x: 2.33, signal: "MEDIUM" },
    { time: "14:57:41", price: 1_655, gain: 4.09, mf: 11_780, vol_x: 2.88, signal: "BIG" },
    { time: "15:25:19", price: 1_645, gain: 3.46, mf: 4_720, vol_x: 1.54, signal: "SMALL" },
    { time: "15:46:33", price: 1_650, gain: 3.77, mf: 10_460, vol_x: 2.62, signal: "BIG" },
    { time: "15:54:27", price: 1_648, gain: 3.65, mf: 3_290, vol_x: 1.21, signal: "SMALL" },
  ],
  bm: [
    { time: "09:17:52", price: 1_618, gain: 1.76, mf: -4_380, vol_x: 1.44, signal: "SMALL" },
    { time: "09:45:16", price: 1_630, gain: 2.52, mf: -7_640, vol_x: 2.06, signal: "MEDIUM" },
    { time: "10:12:44", price: 1_638, gain: 3.02, mf: -5_120, vol_x: 1.58, signal: "SMALL" },
    { time: "10:41:29", price: 1_642, gain: 3.27, mf: -9_870, vol_x: 2.48, signal: "BIG" },
    { time: "11:09:03", price: 1_635, gain: 2.83, mf: -3_540, vol_x: 1.29, signal: "SMALL" },
    { time: "13:41:38", price: 1_648, gain: 3.65, mf: -6_930, vol_x: 1.82, signal: "MEDIUM" },
    { time: "14:16:25", price: 1_652, gain: 3.9, mf: -11_240, vol_x: 2.71, signal: "BIG" },
    { time: "14:48:12", price: 1_645, gain: 3.46, mf: -2_870, vol_x: 1.14, signal: "SMALL" },
    { time: "15:11:47", price: 1_650, gain: 3.77, mf: -8_450, vol_x: 2.13, signal: "MEDIUM" },
    { time: "15:36:09", price: 1_648, gain: 3.65, mf: -5_610, vol_x: 1.61, signal: "SMALL" },
    { time: "15:50:56", price: 1_646, gain: 3.53, mf: -4_190, vol_x: 1.37, signal: "SMALL" },
    { time: "15:58:18", price: 1_645, gain: 3.46, mf: -7_280, vol_x: 1.94, signal: "MEDIUM" },
  ],
};

/** ADRO — distribution: BM prints bigger and later than SM all session. */
const ADRO: TapeSpec = {
  sm: [
    { time: "09:13:08", price: 2_400, gain: 0.23, mf: 6_740, vol_x: 1.86, signal: "MEDIUM" },
    { time: "09:40:31", price: 2_415, gain: 0.86, mf: 4_210, vol_x: 1.47, signal: "SMALL" },
    { time: "10:09:57", price: 2_405, gain: 0.44, mf: 2_680, vol_x: 1.12, signal: "SMALL" },
    { time: "10:38:24", price: 2_420, gain: 1.06, mf: 8_930, vol_x: 2.24, signal: "MEDIUM" },
    { time: "11:07:46", price: 2_425, gain: 1.27, mf: 5_170, vol_x: 1.63, signal: "MEDIUM" },
    { time: "11:36:19", price: 2_410, gain: 0.65, mf: 1_940, vol_x: 0.94, signal: "SMALL" },
    { time: "13:24:52", price: 2_418, gain: 0.98, mf: 7_480, vol_x: 1.98, signal: "MEDIUM" },
    { time: "13:58:37", price: 2_428, gain: 1.4, mf: 3_620, vol_x: 1.31, signal: "SMALL" },
    { time: "14:31:14", price: 2_415, gain: 0.86, mf: 9_260, vol_x: 2.37, signal: "BIG" },
    { time: "15:02:48", price: 2_422, gain: 1.15, mf: 4_580, vol_x: 1.52, signal: "SMALL" },
    { time: "15:29:26", price: 2_418, gain: 0.98, mf: 6_310, vol_x: 1.79, signal: "MEDIUM" },
    { time: "15:52:41", price: 2_415, gain: 0.86, mf: 2_870, vol_x: 1.16, signal: "SMALL" },
  ],
  bm: [
    { time: "09:06:27", price: 2_395, gain: 0.02, mf: -11_480, vol_x: 2.68, signal: "BIG" },
    { time: "09:32:54", price: 2_408, gain: 0.56, mf: -6_920, vol_x: 1.84, signal: "MEDIUM" },
    { time: "10:01:18", price: 2_412, gain: 0.73, mf: -4_350, vol_x: 1.41, signal: "SMALL" },
    { time: "10:29:46", price: 2_418, gain: 0.98, mf: -14_670, vol_x: 3.02, signal: "BIG" },
    { time: "10:58:33", price: 2_422, gain: 1.15, mf: -8_240, vol_x: 2.13, signal: "MEDIUM" },
    { time: "11:27:09", price: 2_415, gain: 0.86, mf: -5_730, vol_x: 1.67, signal: "MEDIUM" },
    { time: "13:16:41", price: 2_420, gain: 1.06, mf: -19_310, vol_x: 3.56, signal: "SUPER BIG" },
    { time: "13:47:58", price: 2_425, gain: 1.27, mf: -7_480, vol_x: 1.93, signal: "MEDIUM" },
    { time: "14:22:16", price: 2_418, gain: 0.98, mf: -12_950, vol_x: 2.61, signal: "BIG" },
    { time: "14:53:44", price: 2_412, gain: 0.73, mf: -3_920, vol_x: 1.38, signal: "SMALL" },
    { time: "15:21:37", price: 2_420, gain: 1.06, mf: -16_840, vol_x: 2.94, signal: "BIG" },
    { time: "15:48:22", price: 2_416, gain: 0.9, mf: -9_160, vol_x: 2.07, signal: "MEDIUM" },
    { time: "15:57:35", price: 2_415, gain: 0.86, mf: -5_270, vol_x: 1.59, signal: "SMALL" },
  ],
};

/** TLKM — quiet ABSORB: SM accumulates in small, steady clips. */
const TLKM: TapeSpec = {
  sm: [
    { time: "09:16:44", price: 3_110, gain: -0.32, mf: 8_640, vol_x: 1.72, signal: "MEDIUM" },
    { time: "09:44:19", price: 3_125, gain: 0.16, mf: 5_210, vol_x: 1.38, signal: "MEDIUM" },
    { time: "10:13:52", price: 3_120, gain: 0.0, mf: 3_470, vol_x: 1.06, signal: "SMALL" },
    { time: "10:42:07", price: 3_130, gain: 0.32, mf: 9_830, vol_x: 1.94, signal: "MEDIUM" },
    { time: "11:11:35", price: 3_135, gain: 0.48, mf: 6_120, vol_x: 1.53, signal: "MEDIUM" },
    { time: "11:39:28", price: 3_125, gain: 0.16, mf: 2_840, vol_x: 0.88, signal: "SMALL" },
    { time: "13:27:14", price: 3_132, gain: 0.38, mf: 7_950, vol_x: 1.83, signal: "MEDIUM" },
    { time: "14:01:49", price: 3_138, gain: 0.57, mf: 4_460, vol_x: 1.29, signal: "SMALL" },
    { time: "14:33:26", price: 3_128, gain: 0.25, mf: 11_270, vol_x: 2.41, signal: "BIG" },
    { time: "15:04:58", price: 3_135, gain: 0.48, mf: 5_690, vol_x: 1.47, signal: "MEDIUM" },
    { time: "15:32:17", price: 3_142, gain: 0.7, mf: 8_130, vol_x: 1.88, signal: "MEDIUM" },
    { time: "15:51:05", price: 3_140, gain: 0.64, mf: 3_920, vol_x: 1.21, signal: "SMALL" },
  ],
  bm: [
    { time: "09:24:36", price: 3_115, gain: -0.16, mf: -6_480, vol_x: 1.51, signal: "MEDIUM" },
    { time: "09:52:03", price: 3_122, gain: 0.06, mf: -4_170, vol_x: 1.24, signal: "SMALL" },
    { time: "10:21:47", price: 3_128, gain: 0.25, mf: -7_920, vol_x: 1.78, signal: "MEDIUM" },
    { time: "10:49:31", price: 3_132, gain: 0.38, mf: -3_540, vol_x: 1.13, signal: "SMALL" },
    { time: "11:18:09", price: 3_130, gain: 0.32, mf: -5_860, vol_x: 1.44, signal: "MEDIUM" },
    { time: "11:46:52", price: 3_126, gain: 0.19, mf: -2_290, vol_x: 0.91, signal: "SMALL" },
    { time: "13:35:28", price: 3_134, gain: 0.45, mf: -9_140, vol_x: 1.96, signal: "MEDIUM" },
    { time: "14:08:14", price: 3_136, gain: 0.51, mf: -4_630, vol_x: 1.32, signal: "SMALL" },
    { time: "14:41:57", price: 3_130, gain: 0.32, mf: -10_780, vol_x: 2.28, signal: "BIG" },
    { time: "15:12:43", price: 3_138, gain: 0.57, mf: -6_310, vol_x: 1.61, signal: "MEDIUM" },
    { time: "15:38:26", price: 3_140, gain: 0.64, mf: -3_870, vol_x: 1.18, signal: "SMALL" },
    { time: "15:55:49", price: 3_140, gain: 0.64, mf: -5_140, vol_x: 1.39, signal: "SMALL" },
  ],
};

/**
 * Transaction tapes keyed by ticker.
 *
 * Every key exists in `mockFlow.tickers`, so selecting one of these names in
 * the table always finds a tape (PRD US-012).
 */
export const mockTransactions: Record<string, TransactionsResponse> = {
  BBCA: build("BBCA", BBCA),
  BBRI: build("BBRI", BBRI),
  GOTO: build("GOTO", GOTO),
  ANTM: build("ANTM", ANTM),
  ADRO: build("ADRO", ADRO),
  TLKM: build("TLKM", TLKM),
};

/**
 * Look up one ticker's tape.
 *
 * A ticker with no mock tape returns an empty tape rather than `undefined`,
 * so the detail panel always has a defined shape to render and never throws
 * (PRD US-005). Callers never need a null check.
 */
export function getTransactions(ticker: string): TransactionsResponse {
  return mockTransactions[ticker] ?? emptyTransactions(ticker);
}

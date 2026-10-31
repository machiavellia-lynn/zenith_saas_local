/**
 * Static mock of `GET /api/flow` (PRD US-004).
 *
 * Field-for-field shape comes from the reference backend:
 *   D:\zenith_saas\routes\routes_flow.py  L234-286   (READ-ONLY)
 *
 * Conventions mirrored from that file:
 *  - `date_from` / `date_to` are DD-MM-YYYY.
 *  - Monetary fields (`sm_val`, `bm_val`, `mf_plus`, `mf_minus`, `net_mf`,
 *    `vwap_sm`, `vwap_bm`, `sm_sma10`, `bm_sma10`) are in Juta (millions of IDR).
 *  - `clean_money` = `sm_val` - `bm_val`, null when either side is unknown.
 *  - `rsm` = sm / (sm + bm) * 100 at 1dp, null when the pair is absent or empty.
 *  - `mes`  = |gain_pct| / sri at 2dp, null unless sri > 0.
 *  - Rows are sorted by `clean_money` descending, nulls last (L269).
 *  - Two distinct "missing data" shapes exist and both are represented here:
 *      * no-flow ticker  -> sm_val / bm_val / clean_money / rsm all null,
 *        but phase is "NEUTRAL" and action is "HOLD" (L194-197, L212-214).
 *      * no-analytics ticker -> phase and action are null (L230-233), so the
 *        UI's no-analytics path is exercised too.
 *
 * The rows are literal, not generated, so the dataset a human reviews is the
 * dataset the tests assert. `totals` is the one exception: it is folded from
 * `tickers`, so the aggregate can never drift from the rows it summarises.
 */

import type { FlowResponse, Phase, TickerRow } from "../types";

/**
 * One ticker's inputs, in the words a trader would use.
 *
 * `sm: null` marks the backend's `_nodata` path: the universe member traded,
 * but the day's SM/BM aggregation is unavailable. Everything the backend
 * derives from that pair goes null with it, while phase/action stay populated.
 *
 * `phase: null` is the separate no-analytics path.
 */
interface Spec {
  ticker: string;
  price: number;
  /** Null when the ticker printed no flow at all, so no gain could be derived. */
  gain: number | null;
  /** SM value, Juta. Null withholds the day's aggregation. */
  sm: number | null;
  /** BM value, Juta. Null withholds the day's aggregation. */
  bm: number | null;
  tx: number;
  phase: Phase | null;
  action: string | null;
  watch: string | null;
  sri: number | null;
  volx_gap: number | null;
  atr_pct: number | null;
  /** Sell pressure ratio, tx_bm / total_tx. */
  rpr: number | null;
  rsi14: number | null;
  cm_streak: number | null;
  ma_structure: string | null;
  narrative: string | null;
}

/** sm / (sm + bm) * 100 at 1dp; null when the pair is absent or empty. */
function rsmOf(sm: number | null, bm: number | null): number | null {
  if (sm === null || bm === null) return null;
  const total = sm + bm;
  if (total <= 0) return null;
  return Math.round((sm / total) * 1000) / 10;
}

/** |gain| / sri at 2dp, mirroring routes_flow.py L250. Null unless sri > 0. */
function mesOf(gain: number | null, sri: number | null): number | null {
  if (gain === null || sri === null || sri <= 0) return null;
  return Math.round((Math.abs(gain) / sri) * 100) / 100;
}

/** Round to 2dp, the backend's rounding for every Juta field. */
function j2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Moving averages are modelled as fixed offsets off the last price so the
 * four of them stay mutually consistent and `ma_structure` reads plausibly.
 */
const MA_FACTORS = { ma5: 0.979, ma13: 0.963, ma34: 0.941, ma200: 0.878 } as const;

/**
 * Fold totals from the rows, exactly as routes_flow.py L271-284 does:
 * `sm`/`bm`/`net_cm` sum the values that exist, `count` counts rows, and the
 * MF aggregates are null when no row carries one.
 */
function totalsOf(tickers: readonly TickerRow[]): FlowResponse["totals"] {
  let sm = 0;
  let bm = 0;
  let netCm = 0;
  const mfPlus: number[] = [];
  const mfMinus: number[] = [];
  const netMf: number[] = [];

  for (const t of tickers) {
    if (t.sm_val !== null) sm += t.sm_val;
    if (t.bm_val !== null) bm += t.bm_val;
    if (t.clean_money !== null) netCm += t.clean_money;
    if (t.mf_plus !== null) mfPlus.push(t.mf_plus);
    if (t.mf_minus !== null) mfMinus.push(t.mf_minus);
    if (t.net_mf !== null) netMf.push(t.net_mf);
  }

  const sumOrNull = (xs: readonly number[]): number | null =>
    xs.length === 0 ? null : j2(xs.reduce((a, b) => a + b, 0));

  return {
    sm: j2(sm),
    bm: j2(bm),
    mf_plus: sumOrNull(mfPlus),
    mf_minus: sumOrNull(mfMinus),
    net_cm: j2(netCm),
    net_mf: sumOrNull(netMf),
    count: tickers.length,
  };
}

/** Backend sort: clean_money descending, nulls last (routes_flow.py L269). */
function byCleanMoneyDesc(a: TickerRow, b: TickerRow): number {
  if (a.clean_money === null && b.clean_money === null) return 0;
  if (a.clean_money === null) return 1;
  if (b.clean_money === null) return -1;
  return b.clean_money - a.clean_money;
}

/** Build one TickerRow, deriving every field the backend derives. */
function buildRow(s: Spec): TickerRow {
  const rsm = rsmOf(s.sm, s.bm);
  const isNoFlow = s.sm === null || s.bm === null;
  const clean = isNoFlow ? null : j2((s.sm as number) - (s.bm as number));
  const sm = s.sm;
  const bm = s.bm;

  return {
    ticker: s.ticker,
    clean_money: clean,
    sm_val: sm,
    bm_val: bm,
    rsm,
    // Mirrors the backend: every value derived from the SM/BM pair is null
    // whenever the pair itself is unavailable.
    mf_plus: isNoFlow ? null : j2((s.sm as number) * (0.88 + (s.ticker.length % 7) / 50)),
    mf_minus: isNoFlow ? null : j2((s.bm as number) * (0.81 + (s.ticker.length % 5) / 40)),
    net_mf: isNoFlow ? null : j2(((s.sm as number) - (s.bm as number)) * 0.68),
    gain_pct: s.gain,
    price: s.price,
    tx: s.tx,
    phase: s.phase,
    action: s.action,
    watch: s.watch,
    sri: s.sri,
    mes: mesOf(s.gain, s.sri),
    volx_gap: s.volx_gap,
    rpr: s.rpr,
    atr_pct: s.atr_pct,
    sm_sma10: isNoFlow ? null : j2((s.sm as number) * 0.87),
    bm_sma10: isNoFlow ? null : j2((s.bm as number) * 0.93),
    vwap_sm: isNoFlow ? null : Math.round(s.price * 0.9955 * 100) / 100,
    vwap_bm: isNoFlow ? null : Math.round(s.price * 1.0043 * 100) / 100,
    ma5: Math.round(s.price * MA_FACTORS.ma5 * 100) / 100,
    ma13: Math.round(s.price * MA_FACTORS.ma13 * 100) / 100,
    ma34: Math.round(s.price * MA_FACTORS.ma34 * 100) / 100,
    ma200: Math.round(s.price * MA_FACTORS.ma200 * 100) / 100,
    rsi14: s.rsi14,
    cm_streak: s.cm_streak,
    ma_structure: s.ma_structure,
    narrative: s.narrative,
  };
}

/**
 * The trading day, 64 names across banks, consumer, telco, metals, coal,
 * cement, property, energy and the tech/small-cap tail.
 *
 * Hand-authored rather than generated: values are deliberately non-round, and
 * the outliers the UI must survive (a null phase, a withheld aggregation, a
 * 150+ character narrative, a deeply negative clean money) are placed on
 * purpose rather than stumbled into.
 */
const SPECS: readonly Spec[] = [
  // ── Accumulation-leaning: SOS / SPRING / ABSORB / ACCUM ──────────────────
  {
    ticker: "BBCA", price: 9875, gain: 1.82, sm: 812_450.37, bm: 214_880.70, tx: 18_432,
    phase: "SOS", action: "BUY", watch: null, sri: 2.84, volx_gap: 1.63, atr_pct: 1.21,
    rpr: 0.21, rsi14: 63.4, cm_streak: 6, ma_structure: "Strong Uptrend",
    narrative: "Strongest Momentum — Smart Money sangat agresif di tengah tren yang sudah kuat. Konfluensi sempurna antara struktur MA bullish dan aksi SM, ini adalah setup dengan probabilitas tertinggi. Hati-hati FOMO di entry terlambat; pastikan tidak trigger Gate C.",
  },
  {
    ticker: "BBRI", price: 4520, gain: 2.31, sm: 604_120.83, bm: 188_770.07, tx: 26_915,
    phase: "SOS", action: "BUY", watch: null, sri: 2.41, volx_gap: 2.08, atr_pct: 1.67,
    rpr: 0.24, rsi14: 66.2, cm_streak: 4, ma_structure: "Strong Uptrend",
    narrative: "Momentum agresif dengan RSM di atas 75% menunjukkan dominasi SM yang jelas sepanjang sesi. Struktur MA fully aligned mendukung kelanjutan tren, namun perhatikan volume yang mulai jenuh di akhir sesi kedua.",
  },
  {
    ticker: "BMRI", price: 6180, gain: 1.44, sm: 478_330.19, bm: 176_540.39, tx: 21_078,
    phase: "SOS", action: "BUY", watch: null, sri: 2.02, volx_gap: 1.41, atr_pct: 1.38,
    rpr: 0.27, rsi14: 61.8, cm_streak: 3, ma_structure: "Strong Uptrend",
    narrative: null,
  },
  {
    ticker: "TLKM", price: 3140, gain: 0.64, sm: 302_880.64, bm: 141_260.68, tx: 15_742,
    phase: "ACCUM", action: "BUY", watch: null, sri: 1.74, volx_gap: 1.12, atr_pct: 1.09,
    rpr: 0.32, rsi14: 57.1, cm_streak: 8, ma_structure: "Transitional Uptrend",
    narrative: "Pemulihan Bertahap — Momentum bullish jangka pendek terbentuk perlahan, SM mulai masuk secara gradual meski MA200 masih jadi ceiling. Cocok untuk akumulasi bertahap dengan position sizing konservatif; avoid all-in karena resistance makro masih ada.",
  },
  {
    ticker: "ASII", price: 5125, gain: 0.98, sm: 264_770.92, bm: 139_410.73, tx: 12_886,
    phase: "ACCUM", action: "BUY", watch: null, sri: 1.68, volx_gap: 1.24, atr_pct: 1.32,
    rpr: 0.34, rsi14: 58.9, cm_streak: 5, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "ANTM", price: 1645, gain: 3.17, sm: 218_640.41, bm: 97_330.100, tx: 19_455,
    phase: "SOS", action: "BUY", watch: null, sri: 2.63, volx_gap: 2.44, atr_pct: 2.18,
    rpr: 0.31, rsi14: 68.7, cm_streak: 2, ma_structure: "Bullish Messy",
    narrative: "Momentum Kuat di Struktur Berantakan — SM sangat agresif tapi MA dalam kondisi chaotic. Sinyal SM valid dan menarik, tapi ketidakjelasan struktur MA menciptakan risiko false signal. Entry dengan sizing lebih kecil dari biasa; konfirmasi dengan apakah MA mulai realign dalam 2-3 hari ke depan.",
  },
  {
    ticker: "KLBF", price: 1470, gain: -1.34, sm: 156_220.76, bm: 71_880.56, tx: 8_674,
    phase: "SPRING", action: "BUY", watch: null, sri: 1.92, volx_gap: 1.08, atr_pct: 1.44,
    rpr: 0.32, rsi14: 44.8, cm_streak: 3, ma_structure: "Transitional Correction",
    narrative: null,
  },
  {
    ticker: "SMGR", price: 3760, gain: -2.06, sm: 134_905.28, bm: 62_140.05, tx: 9_211,
    phase: "SPRING", action: "BUY", watch: null, sri: 1.81, volx_gap: 1.33, atr_pct: 1.86,
    rpr: 0.35, rsi14: 41.2, cm_streak: 2, ma_structure: "Transitional Correction",
    narrative: "Bounce dari Support Makro — Harga turun lebih dalam tapi SM aktif akumulasi, dengan MA200 di bawah sebagai safety net. Setup SPRING dalam konteks koreksi makro bullish adalah salah satu setup terbaik untuk swing entry; risiko relatif terbatas karena floor makro jelas.",
  },
  {
    ticker: "INTP", price: 7195, gain: -1.78, sm: 118_440.53, bm: 58_905.87, tx: 6_538,
    phase: "SPRING", action: "HOLD", watch: "ARB_SPRING", sri: 1.55, volx_gap: 0.94, atr_pct: 2.31,
    rpr: 0.38, rsi14: 38.6, cm_streak: 1, ma_structure: "Bearish Messy",
    narrative: "Bottom Fishing Ekstrem — Harga jatuh dalam kondisi MA chaotic dan di bawah MA200; SM mencoba akumulasi di zona yang sangat tertekan. Setup paling high-risk dalam katalog ini. Hanya relevan jika SRI > 3.0 dan RSM > 68% sebagai konfirmasi minimum. Ukuran posisi sangat kecil.",
  },
  {
    ticker: "UNVR", price: 1845, gain: -0.86, sm: 97_330.87, bm: 51_270.36, tx: 7_084,
    phase: "ABSORB", action: "BUY", watch: null, sri: 1.62, volx_gap: 0.87, atr_pct: 1.53,
    rpr: 0.36, rsi14: 46.3, cm_streak: 7, ma_structure: "Transitional Correction",
    narrative: null,
  },
  {
    ticker: "ICBP", price: 10_825, gain: 0.42, sm: 88_640.14, bm: 44_915.02, tx: 5_129,
    phase: "ABSORB", action: "BUY", watch: null, sri: 1.44, volx_gap: 0.81, atr_pct: 0.98,
    rpr: 0.33, rsi14: 52.7, cm_streak: 4, ma_structure: "Cluster on Macro Uptrend",
    narrative: "Akumulasi Diam-diam dalam Konsolidasi — SM mengumpulkan posisi dengan sabar di tengah sideways yang ketat. Ini adalah fasa sebelum breakout; pasar belum notice tapi big players sudah positioning. Hold atau tambah posisi gradual; tunggu harga keluar dari cluster.",
  },
  {
    ticker: "INDF", price: 6_575, gain: 0.31, sm: 74_220.69, bm: 48_770.04, tx: 6_442,
    phase: "ABSORB", action: "HOLD", watch: null, sri: 1.31, volx_gap: 0.76, atr_pct: 1.06,
    rpr: 0.41, rsi14: 51.4, cm_streak: 2, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "JPFA", price: 1_785, gain: -1.12, sm: 39_885.35, bm: 41_220.56, tx: 4_918,
    phase: "SPRING", action: "HOLD", watch: null, sri: 0.94, volx_gap: 0.69, atr_pct: 2.02,
    rpr: 0.49, rsi14: 43.1, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "TOWR", price: 2_310, gain: 1.27, sm: 68_115.91, bm: 33_470.65, tx: 4_603,
    phase: "ACCUM", action: "BUY", watch: null, sri: 1.58, volx_gap: 1.17, atr_pct: 1.61,
    rpr: 0.31, rsi14: 56.8, cm_streak: 6, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "EXCL", price: 2_265, gain: -0.53, sm: 57_330.47, bm: 63_905.44, tx: 5_271,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.88, volx_gap: 0.72, atr_pct: 1.24,
    rpr: 0.52, rsi14: 47.9, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "ISAT", price: 9_450, gain: 1.06, sm: 47_880.72, bm: 30_115.26, tx: 3_842,
    phase: "ACCUM", action: "BUY", watch: null, sri: 1.47, volx_gap: 1.04, atr_pct: 1.42,
    rpr: 0.36, rsi14: 54.2, cm_streak: 3, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "TBIG", price: 2_640, gain: 0.88, sm: 31_240.23, bm: 19_885.68, tx: 2_914,
    phase: "ACCUM", action: "BUY", watch: null, sri: 1.29, volx_gap: 0.98, atr_pct: 1.55,
    rpr: 0.35, rsi14: 53.6, cm_streak: 4, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "MTEL", price: 655, gain: 2.34, sm: 28_770.58, bm: 12_440.24, tx: 11_206,
    phase: "SOS", action: "BUY", watch: null, sri: 2.18, volx_gap: 1.87, atr_pct: 2.44,
    rpr: 0.29, rsi14: 64.9, cm_streak: 2, ma_structure: "Bullish Messy",
    narrative: null,
  },
  {
    ticker: "BRPT", price: 1_065, gain: 4.41, sm: 44_330.96, bm: 15_990.02, tx: 14_873,
    phase: "SOS", action: "BUY", watch: null, sri: 3.12, volx_gap: 3.16, atr_pct: 3.02,
    rpr: 0.26, rsi14: 71.3, cm_streak: 1, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "MIKA", price: 2_780, gain: 0.72, sm: 21_905.31, bm: 17_340.27, tx: 2_188,
    phase: "ABSORB", action: "HOLD", watch: null, sri: 1.12, volx_gap: 0.83, atr_pct: 1.31,
    rpr: 0.44, rsi14: 50.2, cm_streak: 2, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },

  // ── Distribution-leaning: UPTHRUST / DISTRI ──────────────────────────────
  {
    ticker: "GOTO", price: 71, gain: 1.43, sm: 92_640.84, bm: 121_880.14, tx: 48_915,
    phase: "UPTHRUST", action: "SELL", watch: null, sri: 0.71, volx_gap: 1.92, atr_pct: 2.88,
    rpr: 0.57, rsi14: 54.6, cm_streak: null, ma_structure: "Bullish Messy",
    narrative: "Trap di Puncak Tren — Harga naik tinggi tapi BM dominan dan RPR lemah, sinyal jebakan distribusi meski struktur MA masih bullish. Ini warning penting: MA bisa lag terhadap perubahan arah. Waspadai potensi reversal jangka pendek meski tren besar masih intact.",
  },
  {
    ticker: "ADRO", price: 2_415, gain: 0.86, sm: 187_440.16, bm: 224_905.17, tx: 16_338,
    phase: "UPTHRUST", action: "SELL", watch: null, sri: 0.83, volx_gap: 1.74, atr_pct: 2.11,
    rpr: 0.55, rsi14: 56.4, cm_streak: null, ma_structure: "Transitional Correction",
    narrative: null,
  },
  {
    ticker: "ITMG", price: 24_875, gain: -1.64, sm: 143_220.62, bm: 208_540.53, tx: 8_127,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.92, volx_gap: 1.58, atr_pct: 1.94,
    rpr: 0.59, rsi14: 42.7, cm_streak: null, ma_structure: "Transitional Correction",
    narrative: "Distribusi Tersembunyi — BM mulai aktif mendistribusi meski MA masih bullish aligned. Ini adalah early warning sign sebelum tren berbalik; MA biasanya lag beberapa hari. Hold posisi lama dengan trailing stop, hindari entry baru sampai ada konfirmasi.",
  },
  {
    ticker: "PTBA", price: 2_680, gain: -2.19, sm: 121_470.43, bm: 176_330.14, tx: 10_942,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.88, volx_gap: 1.81, atr_pct: 2.27,
    rpr: 0.59, rsi14: 39.4, cm_streak: null, ma_structure: "Transitional Correction",
    narrative: null,
  },
  {
    ticker: "MDKA", price: 2_150, gain: -3.42, sm: 96_115.79, bm: 154_770.77, tx: 13_576,
    phase: "DISTRI", action: "SELL", watch: null, sri: 1.04, volx_gap: 2.23, atr_pct: 3.14,
    rpr: 0.62, rsi14: 34.8, cm_streak: null, ma_structure: "Strong Downtrend",
    narrative: "Downtrend Diperkuat — BM aktif mendistribusi dengan semua MA masih bearish; ini adalah konfirmasi downtrend paling kuat. Tidak ada alasan untuk hold, apalagi beli. Jika belum exit, ini momentum terakhir sebelum harga turun lebih dalam.",
  },
  {
    ticker: "INCO", price: 3_420, gain: -1.87, sm: 78_905.26, bm: 112_440.90, tx: 7_463,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.96, volx_gap: 1.66, atr_pct: 2.38,
    rpr: 0.59, rsi14: 40.1, cm_streak: null, ma_structure: "Transitional Correction",
    narrative: null,
  },
  {
    ticker: "BUMI", price: 138, gain: 2.22, sm: 34_880.67, bm: 58_220.90, tx: 32_884,
    phase: "UPTHRUST", action: "SELL", watch: null, sri: 0.74, volx_gap: 2.61, atr_pct: 3.42,
    rpr: 0.63, rsi14: 55.9, cm_streak: null, ma_structure: "Bullish Messy",
    narrative: null,
  },
  {
    ticker: "ENRG", price: 1_265, gain: 1.94, sm: 22_440.12, bm: 34_905.88, tx: 9_338,
    phase: "UPTHRUST", action: "SELL", watch: null, sri: 0.79, volx_gap: 1.98, atr_pct: 2.73,
    rpr: 0.61, rsi14: 53.2, cm_streak: null, ma_structure: "Bullish Messy",
    narrative: null,
  },
  {
    ticker: "MEDC", price: 1_395, gain: -0.71, sm: 18_330.88, bm: 29_880.43, tx: 8_115,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.86, volx_gap: 1.44, atr_pct: 2.51,
    rpr: 0.62, rsi14: 44.6, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "PGAS", price: 1_620, gain: -1.45, sm: 64_770.39, bm: 89_115.85, tx: 6_884,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.91, volx_gap: 1.52, atr_pct: 1.88,
    rpr: 0.58, rsi14: 41.9, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "AKRA", price: 1_485, gain: 0.34, sm: 27_905.74, bm: 38_440.41, tx: 5_427,
    phase: "UPTHRUST", action: "HOLD", watch: null, sri: 0.82, volx_gap: 1.29, atr_pct: 2.06,
    rpr: 0.58, rsi14: 49.8, cm_streak: null, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "ELSA", price: 486, gain: 2.97, sm: 12_440.21, bm: 19_885.54, tx: 7_336,
    phase: "UPTHRUST", action: "SELL", watch: null, sri: 0.68, volx_gap: 2.34, atr_pct: 3.27,
    rpr: 0.62, rsi14: 57.3, cm_streak: null, ma_structure: "Bullish Messy",
    narrative: null,
  },
  {
    ticker: "HRUM", price: 1_115, gain: -2.53, sm: 9_885.56, bm: 17_220.09, tx: 5_948,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.93, volx_gap: 1.89, atr_pct: 3.08,
    rpr: 0.64, rsi14: 37.5, cm_streak: null, ma_structure: "Bearish Messy",
    narrative: null,
  },

  // ── NEUTRAL band, mild positive and mild negative ────────────────────────
  {
    ticker: "UNTR", price: 26_350, gain: 0.19, sm: 158_905.93, bm: 144_330.80, tx: 5_773,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 1.06, volx_gap: 0.88, atr_pct: 1.36,
    rpr: 0.48, rsi14: 52.1, cm_streak: 1, ma_structure: "Strong Uptrend",
    narrative: "Konsolidasi dalam Tren Kuat — Tidak ada aksi SM atau BM yang dominan hari ini, pasar istirahat sejenak. Struktur MA masih bullish penuh; ini bukan sinyal untuk keluar. Hold posisi, tunggu fase berikutnya yang kemungkinan besar masih bullish.",
  },
  {
    ticker: "AMMN", price: 8_175, gain: 0.52, sm: 132_440.48, bm: 118_905.51, tx: 9_612,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 1.11, volx_gap: 0.96, atr_pct: 1.73,
    rpr: 0.47, rsi14: 53.4, cm_streak: 2, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "TPIA", price: 7_650, gain: -0.29, sm: 88_115.81, bm: 81_330.92, tx: 4_627,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 1.02, volx_gap: 0.84, atr_pct: 1.67,
    rpr: 0.48, rsi14: 50.6, cm_streak: 1, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "CPIN", price: 4_780, gain: -0.42, sm: 61_905.34, bm: 57_440.49, tx: 4_112,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.98, volx_gap: 0.79, atr_pct: 1.44,
    rpr: 0.51, rsi14: 49.3, cm_streak: null, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "AALI", price: 5_950, gain: 0.08, sm: 24_880.68, bm: 23_440.97, tx: 1_984,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.87, volx_gap: 0.61, atr_pct: 1.52,
    rpr: 0.49, rsi14: 50.1, cm_streak: 1, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "LSIP", price: 1_095, gain: -0.9, sm: 17_330.17, bm: 21_905.24, tx: 3_447,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.81, volx_gap: 0.74, atr_pct: 2.09,
    rpr: 0.57, rsi14: 46.2, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "INKP", price: 8_425, gain: 1.13, sm: 33_905.59, bm: 28_440.31, tx: 2_773,
    phase: "ACCUM", action: "BUY", watch: null, sri: 1.34, volx_gap: 1.09, atr_pct: 1.71,
    rpr: 0.43, rsi14: 55.7, cm_streak: 3, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "TKIM", price: 6_225, gain: 0.77, sm: 22_115.86, bm: 19_770.29, tx: 1_882,
    phase: "ABSORB", action: "HOLD", watch: null, sri: 1.18, volx_gap: 0.77, atr_pct: 1.83,
    rpr: 0.46, rsi14: 52.8, cm_streak: 2, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "BRIS", price: 2_890, gain: 1.68, sm: 41_770.42, bm: 26_905.07, tx: 6_114,
    phase: "SOS", action: "BUY", watch: null, sri: 1.96, volx_gap: 1.53, atr_pct: 1.92,
    rpr: 0.37, rsi14: 61.4, cm_streak: 4, ma_structure: "Strong Uptrend",
    narrative: null,
  },
  {
    ticker: "ARTO", price: 2_540, gain: 3.24, sm: 38_440.77, bm: 21_115.63, tx: 8_903,
    phase: "SOS", action: "BUY", watch: null, sri: 2.74, volx_gap: 2.48, atr_pct: 2.66,
    rpr: 0.33, rsi14: 67.8, cm_streak: 2, ma_structure: "Bullish Messy",
    narrative: null,
  },
  {
    ticker: "BBTN", price: 1_285, gain: 0.63, sm: 19_905.24, bm: 18_330.75, tx: 3_019,
    phase: "ACCUM", action: "HOLD", watch: null, sri: 1.09, volx_gap: 0.92, atr_pct: 1.58,
    rpr: 0.47, rsi14: 52.4, cm_streak: 2, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "PNBN", price: 1_320, gain: -0.38, sm: 14_440.63, bm: 16_905.61, tx: 2_447,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.89, volx_gap: 0.68, atr_pct: 1.36,
    rpr: 0.54, rsi14: 48.7, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "BDMN", price: 2_150, gain: 0.94, sm: 11_330.94, bm: 9_885.87, tx: 1_663,
    phase: "ACCUM", action: "HOLD", watch: null, sri: 1.21, volx_gap: 0.86, atr_pct: 1.77,
    rpr: 0.45, rsi14: 54.1, cm_streak: 3, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "BNGA", price: 1_745, gain: 1.16, sm: 16_905.38, bm: 13_440.78, tx: 2_188,
    phase: "ACCUM", action: "BUY", watch: null, sri: 1.42, volx_gap: 1.02, atr_pct: 1.49,
    rpr: 0.42, rsi14: 55.2, cm_streak: 4, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "NISP", price: 1_395, gain: 0.36, sm: 9_440.71, bm: 8_905.19, tx: 1_447,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 1.04, volx_gap: 0.71, atr_pct: 1.62,
    rpr: 0.48, rsi14: 51.6, cm_streak: 1, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "SRTG", price: 1_780, gain: -1.11, sm: 6_905.29, bm: 8_330.12, tx: 998,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.84, volx_gap: 1.13, atr_pct: 1.94,
    rpr: 0.56, rsi14: 43.4, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "MAPI", price: 1_455, gain: 0.69, sm: 8_115.54, bm: 7_440.95, tx: 1_774,
    phase: "ABSORB", action: "HOLD", watch: null, sri: 1.16, volx_gap: 0.81, atr_pct: 2.13,
    rpr: 0.47, rsi14: 52.9, cm_streak: 2, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "ACES", price: 745, gain: -0.67, sm: 7_440.89, bm: 9_115.51, tx: 3_772,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.92, volx_gap: 0.88, atr_pct: 2.07,
    rpr: 0.55, rsi14: 46.8, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "ERAA", price: 402, gain: 1.51, sm: 6_330.46, bm: 4_885.36, tx: 2_118,
    phase: "SOS", action: "BUY", watch: null, sri: 1.87, volx_gap: 1.44, atr_pct: 2.42,
    rpr: 0.42, rsi14: 60.3, cm_streak: 2, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "SCMA", price: 1_930, gain: 0.44, sm: 4_905.73, bm: 4_440.34, tx: 1_284,
    phase: "ACCUM", action: "HOLD", watch: null, sri: 1.07, volx_gap: 0.76, atr_pct: 1.88,
    rpr: 0.47, rsi14: 51.9, cm_streak: 1, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "PWON", price: 398, gain: -0.5, sm: 8_905.18, bm: 10_440.32, tx: 4_019,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.94, volx_gap: 0.83, atr_pct: 1.96,
    rpr: 0.54, rsi14: 48.2, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "CTRA", price: 1_185, gain: 1.28, sm: 18_440.61, bm: 15_885.46, tx: 4_885,
    phase: "ACCUM", action: "BUY", watch: null, sri: 1.53, volx_gap: 1.11, atr_pct: 1.84,
    rpr: 0.4, rsi14: 56.3, cm_streak: 3, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "BSDE", price: 1_015, gain: -1.46, sm: 12_905.97, bm: 16_330.09, tx: 3_227,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.87, volx_gap: 1.32, atr_pct: 2.24,
    rpr: 0.58, rsi14: 42.3, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "SMRA", price: 615, gain: 0.82, sm: 9_885.32, bm: 8_440.34, tx: 3_884,
    phase: "ABSORB", action: "HOLD", watch: null, sri: 1.14, volx_gap: 0.91, atr_pct: 2.02,
    rpr: 0.46, rsi14: 52.6, cm_streak: 2, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "JSMR", price: 4_680, gain: 0.55, sm: 21_440.66, bm: 19_905.82, tx: 2_114,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 1.03, volx_gap: 0.79, atr_pct: 1.62,
    rpr: 0.48, rsi14: 51.2, cm_streak: 1, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },
  {
    ticker: "PTPP", price: 452, gain: -2.38, sm: 5_905.13, bm: 9_440.95, tx: 2_663,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.81, volx_gap: 1.71, atr_pct: 2.86,
    rpr: 0.61, rsi14: 38.9, cm_streak: null, ma_structure: "Bearish Messy",
    narrative: null,
  },
  {
    ticker: "ADHI", price: 272, gain: 1.87, sm: 4_440.82, bm: 3_905.99, tx: 1_884,
    phase: "SOS", action: "BUY", watch: null, sri: 1.72, volx_gap: 1.51, atr_pct: 3.11,
    rpr: 0.44, rsi14: 58.7, cm_streak: 1, ma_structure: "Transitional Uptrend",
    narrative: null,
  },
  {
    ticker: "WIKA", price: 348, gain: -1.14, sm: 3_905.44, bm: 5_440.22, tx: 1_447,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.86, volx_gap: 0.94, atr_pct: 2.74,
    rpr: 0.56, rsi14: 44.9, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "WSKT", price: 186, gain: -3.11, sm: 2_440.78, bm: 6_905.70, tx: 2_118,
    phase: "DISTRI", action: "SELL", watch: null, sri: 0.76, volx_gap: 2.06, atr_pct: 4.18,
    rpr: 0.66, rsi14: 33.7, cm_streak: null, ma_structure: "Bearish Messy",
    narrative: "Silent Exit — BM mendistribusi secara tenang dalam sideways yang sudah di bawah MA200; ini adalah tanda bahwa big players sedang keluar secara halus sebelum breakdown. Konfirmasi bearish paling kuat dalam konteks ini. Segera reduce atau exit posisi.",
  },
  {
    ticker: "HEAL", price: 1_420, gain: -0.35, sm: 12_880.27, bm: 14_330.97, tx: 4_116,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: 0.93, volx_gap: 0.81, atr_pct: 1.74,
    rpr: 0.53, rsi14: 47.6, cm_streak: null, ma_structure: "Cluster on Macro Downtrend",
    narrative: null,
  },
  {
    ticker: "SIDO", price: 545, gain: 0.92, sm: 7_115.57, bm: 6_440.17, tx: 2_663,
    phase: "ACCUM", action: "HOLD", watch: null, sri: 1.19, volx_gap: 0.89, atr_pct: 1.66,
    rpr: 0.46, rsi14: 53.1, cm_streak: 2, ma_structure: "Cluster on Macro Uptrend",
    narrative: null,
  },

  // ── Edge cases the UI must survive ───────────────────────────────────────
  // `_nodata` path (routes_flow.py L194-197, L212-214): the ticker is in the
  // universe but the day's flow was never aggregated. Totals are withheld;
  // phase/action are NOT null — the backend emits NEUTRAL/HOLD here.
  {
    ticker: "NZIA", price: 342, gain: 0.0, sm: null, bm: null, tx: 41,
    phase: "NEUTRAL", action: "HOLD", watch: null, sri: null, volx_gap: null, atr_pct: null,
    rpr: null, rsi14: null, cm_streak: null, ma_structure: null,
    narrative: null,
  },
  // No-analytics path (routes_flow.py L230-233): phase and action are null.
  {
    ticker: "RAJA", price: 3_910, gain: null, sm: null, bm: null, tx: 0,
    phase: null, action: null, watch: null, sri: null, volx_gap: null, atr_pct: null,
    rpr: null, rsi14: null, cm_streak: null, ma_structure: null,
    narrative: null,
  },
];

const tickers: TickerRow[] = SPECS.map(buildRow).sort(byCleanMoneyDesc);

/** Mock snapshot of the day's flow, shaped exactly like `GET /api/flow`. */
export const mockFlow: FlowResponse = {
  tickers,
  totals: totalsOf(tickers),
  date_from: "02-10-2026",
  date_to: "02-10-2026",
};

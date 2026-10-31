/**
 * Dummy data for the Stock page.
 *
 * Nothing here is wired to a backend yet — the SM/BM block in particular will
 * eventually come from `eod_summary` (see D:\zenith_saas\routes\routes_flow.py,
 * /api/flow), which the live app computes server-side. Until then the numbers
 * are illustrative so the layout can be judged at full density.
 *
 * The shapes are the real ones: `running_trade` and `broker_summary` both exist
 * in the local `zenith` database, so the aggregations this page performs are the
 * same ones the SQL will perform later.
 */

import type {
  BrokerRow,
  BrokerSummaryFilters,
  Candle,
  SmBmPanel,
  StockSnapshot,
  TradeBookRow,
} from "../types.stock";

/** The nine SM/BM figures the Flow popup shows, plus its derived ratios. */
export const mockSmBm: SmBmPanel = {
  sm: 156.2,
  bm: 71.9,
  netCm: 84.3,
  cmStreak: 3,
  mfPlus: 150.0,
  mfMinus: 65.4,
  netMf: 57.4,
  tx: 8674,
  intensity: {
    rsm: 68.5,
    sri: 1.92,
    mes: 0.7,
    rpr: 0.32,
    atrPct: 1.44,
    volxGap: 1.08,
  },
  vwapSm: 1463.39,
  vwapBm: 1476.32,
};

/**
 * Per-price-level breakdown for one session.
 *
 * `sellFrequency` / `buyFrequency` come from the tape; the two single-sided
 * levels (the session high and the session low) carry nulls on the empty side
 * rather than zeros, which is how the API reports them.
 */
export const mockTradeBook: readonly TradeBookRow[] = [
  { price: 1495, buyLot: 12097, sellLot: null, netLot: null, buyFrequency: 230, sellFrequency: null, buyPct: 100 },
  { price: 1490, buyLot: 12597, sellLot: 10882, netLot: 1715, buyFrequency: 197, sellFrequency: 15, buyPct: 54 },
  { price: 1485, buyLot: 45380, sellLot: 13139, netLot: 32241, buyFrequency: 665, sellFrequency: 171, buyPct: 78 },
  { price: 1480, buyLot: 87133, sellLot: 148553, netLot: -61420, buyFrequency: 691, sellFrequency: 1044, buyPct: 37 },
  { price: 1475, buyLot: 98832, sellLot: 243114, netLot: -144282, buyFrequency: 742, sellFrequency: 1108, buyPct: 29 },
  { price: 1470, buyLot: 40929, sellLot: 11250, netLot: 29679, buyFrequency: 596, sellFrequency: 88, buyPct: 78 },
  { price: 1465, buyLot: 219850, sellLot: 110820, netLot: 109030, buyFrequency: 1009, sellFrequency: 640, buyPct: 66 },
  { price: 1460, buyLot: 92607, sellLot: 116990, netLot: -24383, buyFrequency: 1088, sellFrequency: 733, buyPct: 44 },
  { price: 1455, buyLot: 40011, sellLot: 35268, netLot: 4743, buyFrequency: 532, sellFrequency: 397, buyPct: 53 },
  { price: 1450, buyLot: 2918, sellLot: 4595, netLot: -1677, buyFrequency: 112, sellFrequency: 92, buyPct: 39 },
  { price: 1445, buyLot: 820, sellLot: 6805, netLot: -5985, buyFrequency: 98, sellFrequency: 87, buyPct: 11 },
  { price: 1440, buyLot: null, sellLot: 13891, netLot: null, buyFrequency: null, sellFrequency: 32, buyPct: 0 },
];

/** Header figures for the session. */
export const mockSnapshot: StockSnapshot = {
  ticker: "DSSA",
  name: "Dian Swastatika Sentosa Tbk",
  date: "2026-10-29",
  last: 1465,
  changePct: 2.31,
  open: 1440,
  high: 1495,
  low: 1436,
  vwap: 1461.8,
  volume: 89_969_300,
  value: 164_260_128_000,
  frequency: 13_507,
  prevClose: 1432,
  foreignBuy: 29_361_412_000,
  foreignSell: 28_519_427_000,
  foreignNet: 841_985_000,
};

/**
 * Broker summary, both sides, with the gross value and its frequency.
 *
 * Sorted by value descending within each side, which is the order the panel
 * renders whether it is showing gross or net.
 */
const BUY: readonly [string, string, number, number][] = [
  ["DH", "Lokal", 43_514_483_500, 1644],
  ["AK", "Asing", 22_138_890_500, 1433],
  ["CC", "Pemerintah", 19_248_613_500, 1407],
  ["XL", "Lokal", 13_564_086_000, 3610],
  ["BK", "Asing", 11_377_663_000, 569],
  ["TS", "Lokal", 6_500_000_000, 127],
  ["DP", "Asing", 6_500_000_000, 4],
  ["XC", "Lokal", 5_210_828_500, 927],
  ["ZP", "Asing", 4_602_680_000, 327],
  ["HD", "Asing", 4_479_624_500, 525],
  ["YP", "Asing", 4_056_797_500, 890],
  ["AI", "Asing", 3_382_462_500, 445],
];

const SELL: readonly [string, string, number, number][] = [
  ["CC", "Pemerintah", 26_365_448_000, 2415],
  ["XL", "Lokal", 20_396_733_500, 3400],
  ["KI", "Lokal", 16_864_698_500, 139],
  ["AK", "Asing", 12_172_867_000, 955],
  ["YU", "Asing", 12_122_422_000, 216],
  ["DX", "Pemerintah", 7_943_887_000, 75],
  ["YP", "Asing", 6_661_965_000, 729],
  ["PD", "Lokal", 5_682_932_500, 672],
  ["AG", "Asing", 4_439_773_000, 351],
  ["HD", "Asing", 4_370_064_500, 252],
  ["SS", "Lokal", 3_713_425_000, 178],
  ["XC", "Lokal", 3_605_896_000, 604],
];

/** Buy side gross less sell side gross, per broker, for the NET mode. */
function netOf(code: string): number {
  const b = BUY.find((r) => r[0] === code)?.[2] ?? 0;
  const s = SELL.find((r) => r[0] === code)?.[2] ?? 0;
  return b - s;
}

export const mockBrokers: readonly BrokerRow[] = [
  ...BUY.map(([code, group, value, frequency]): BrokerRow => ({
    brokerCode: code,
    investorGroup: group,
    side: "BUY",
    value,
    frequency,
    netValue: netOf(code),
  })),
  ...SELL.map(([code, group, value, frequency]): BrokerRow => ({
    brokerCode: code,
    investorGroup: group,
    side: "SELL",
    value,
    frequency,
    netValue: netOf(code),
  })),
];

/** The filters the panel starts from. */
export const DEFAULT_BROKER_FILTERS: BrokerSummaryFilters = {
  mode: "gross",
  board: "all",
  investor: "all",
};

/**
 * Daily candles for the chart.
 *
 * Prices are adjusted-close consistent within the series; volume is in shares.
 */
export const mockCandlesStock: readonly Candle[] = [
  { date: "2026-10-16", open: 1220, high: 1254, low: 1218, close: 1248, volume: 12_400_000 },
  { date: "2026-10-17", open: 1248, high: 1288, low: 1244, close: 1281, volume: 18_900_000 },
  { date: "2026-10-20", open: 1281, high: 1302, low: 1266, close: 1274, volume: 21_300_000 },
  { date: "2026-10-21", open: 1274, high: 1330, low: 1270, close: 1326, volume: 27_800_000 },
  { date: "2026-10-22", open: 1326, high: 1388, low: 1322, close: 1381, volume: 41_200_000 },
  { date: "2026-10-23", open: 1381, high: 1432, low: 1376, close: 1428, volume: 52_600_000 },
  { date: "2026-10-24", open: 1428, high: 1444, low: 1402, close: 1416, volume: 38_100_000 },
  { date: "2026-10-27", open: 1416, high: 1452, low: 1410, close: 1447, volume: 44_700_000 },
  { date: "2026-10-28", open: 1447, high: 1468, low: 1421, close: 1432, volume: 33_500_000 },
  { date: "2026-10-29", open: 1440, high: 1495, low: 1436, close: 1465, volume: 89_969_300 },
];

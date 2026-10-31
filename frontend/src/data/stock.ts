/**
 * Data for the Stock page: one symbol, one session window.
 *
 * Live, it is assembled from two backend reads —
 *   GET /api/ohlcv   candles, name           (Yahoo, daily)
 *   GET /api/flow    the symbol's SM/BM row  (the window's flow snapshot)
 * — and what the database does not hold is reported in `missing`, never filled
 * with mock figures: there is no per-price trade book, no broker summary, and no
 * foreign flow, and a mock row on a live screen reads as real.
 */

import type { FlowResponse, TickerRow } from "../types";
import type {
  BrokerRow,
  Candle,
  SmBmPanel,
  StockSnapshot,
  TradeBookRow,
} from "../types.stock";
import {
  getJson,
  liveOrMock,
  resolveWindow,
  type DataResult,
  type DateWindow,
} from "./http";
import { flowUrl } from "./index";
import { readOhlcv } from "./pages";
import {
  mockBrokers,
  mockCandlesStock,
  mockSmBm,
  mockSnapshot,
  mockTradeBook,
} from "./mockStock";

export interface StockData {
  snapshot: StockSnapshot;
  candles: readonly Candle[];
  tradeBook: readonly TradeBookRow[];
  smBm: SmBmPanel;
  brokers: readonly BrokerRow[];
  /** Blocks the backend cannot feed; the page says so instead of drawing an empty table. */
  missing: { tradeBook: boolean; brokers: boolean };
}

/** Sessions kept for the chart; the daily series reaches back decades. */
export const MAX_SESSIONS = 800;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function ddmmyyyyToIso(d: string): string {
  const [dd, mm, yyyy] = d.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

/** The newest candle on or before `iso`, and the one before it. */
export function pickSession(
  candles: readonly Candle[],
  iso: string,
): { session: Candle | null; prev: Candle | null } {
  let idx = -1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c !== undefined && c.date <= iso) idx = i;
    else break;
  }
  if (idx < 0) return { session: null, prev: null };
  return { session: candles[idx] ?? null, prev: candles[idx - 1] ?? null };
}

export function buildSnapshot(
  ticker: string,
  name: string | null,
  iso: string,
  candles: readonly Candle[],
): StockSnapshot {
  const { session, prev } = pickSession(candles, iso);
  return {
    ticker,
    name: name ?? ticker,
    date: session?.date ?? iso,
    last: session?.close ?? null,
    changePct:
      session !== null && prev !== null && prev.close > 0
        ? round2(((session.close - prev.close) / prev.close) * 100)
        : null,
    open: session?.open ?? null,
    high: session?.high ?? null,
    low: session?.low ?? null,
    vwap: null,
    volume: session?.volume ?? null,
    value: null,
    frequency: null,
    prevClose: prev?.close ?? null,
    foreignBuy: null,
    foreignSell: null,
    foreignNet: null,
  };
}

/**
 * The SM/BM block from the symbol's flow row.
 *
 * `covered` is false when the whole market has no SM/BM for the window (days
 * before the Telegram history starts): those figures are unknown, not zero, so
 * they come out null. Price-derived intensity (ATR) is still real.
 */
export function buildSmBm(row: TickerRow | undefined, covered: boolean): SmBmPanel {
  const flow = <T>(v: T | null | undefined): T | null => (covered && row ? (v ?? null) : null);
  return {
    sm: flow(row?.sm_val),
    bm: flow(row?.bm_val),
    netCm: flow(row?.clean_money),
    cmStreak: flow(row?.cm_streak),
    mfPlus: flow(row?.mf_plus),
    mfMinus: flow(row?.mf_minus),
    netMf: flow(row?.net_mf),
    tx: covered && row ? row.tx : null,
    intensity: {
      rsm: flow(row?.rsm),
      sri: flow(row?.sri),
      mes: flow(row?.mes),
      rpr: flow(row?.rpr),
      atrPct: row?.atr_pct ?? null,
      volxGap: flow(row?.volx_gap),
    },
    vwapSm: flow(row?.vwap_sm),
    vwapBm: flow(row?.vwap_bm),
  };
}

export function assembleStock(
  ticker: string,
  name: string | null,
  candles: readonly Candle[],
  flow: FlowResponse,
  window: DateWindow,
): StockData {
  const iso = ddmmyyyyToIso(window.to);
  const row = flow.tickers.find((t) => t.ticker === ticker);
  const covered = flow.totals.sm > 0 || flow.totals.bm > 0;
  return {
    snapshot: buildSnapshot(ticker, name, iso, candles),
    candles: candles.slice(-MAX_SESSIONS),
    tradeBook: [],
    smBm: buildSmBm(row, covered),
    brokers: [],
    missing: { tradeBook: true, brokers: true },
  };
}

export function fetchStock(
  ticker: string,
  window?: DateWindow,
): Promise<DataResult<StockData>> {
  return liveOrMock(
    async (base) => {
      const w = await resolveWindow(base, window);
      const [ohlcv, flow] = await Promise.all([
        readOhlcv(base, ticker, "1d"),
        getJson<FlowResponse>(flowUrl(base, w.from, w.to)),
      ]);
      return assembleStock(ticker, ohlcv.name, ohlcv.series.points, flow, w);
    },
    () => ({
      snapshot: mockSnapshot,
      candles: mockCandlesStock,
      tradeBook: mockTradeBook,
      smBm: mockSmBm,
      brokers: mockBrokers,
      missing: { tradeBook: false, brokers: false },
    }),
  );
}

/**
 * Types for the Stock page.
 *
 * Monetary fields are in IDR (rupiah) unless the name says otherwise — the
 * Flow page's own figures are Juta, so the unit is spelled out on every field
 * that could be read either way.
 */

/** One price level's buy/sell breakdown for a session. */
export interface TradeBookRow {
  price: number;
  /** Lots bought at this level. Null when only one side traded. */
  buyLot: number | null;
  /** Lots sold at this level. Null when only one side traded. */
  sellLot: number | null;
  /** buyLot − sellLot. Null whenever either side is null, never 0. */
  netLot: number | null;
  buyFrequency: number | null;
  sellFrequency: number | null;
  /** Buy share of the level, 0–100. */
  buyPct: number;
}

/** Which broker figures the summary shows. */
export type BrokerMode = "gross" | "net";

/** Trading board the summary is filtered to. */
export type BrokerBoard = "all" | "regular" | "tunai" | "nego";

/** Investor class the summary is filtered to. */
export type BrokerInvestor = "all" | "domestic" | "foreign";

export interface BrokerSummaryFilters {
  mode: BrokerMode;
  board: BrokerBoard;
  investor: BrokerInvestor;
}

/** One broker's totals within one side for a session. */
export interface BrokerRow {
  brokerCode: string;
  investorGroup: string;
  side: "BUY" | "SELL";
  /** Gross value on this side, IDR. */
  value: number;
  /** Trade count on this side. */
  frequency: number;
  /** value_on_this_side − value_on_the_other_side, IDR. Can be negative. */
  netValue: number;
}

/**
 * The SM/BM block, mirroring the Flow popup.
 *
 * Values are Juta (millions of IDR), matching the Flow page's contract.
 * `rsm`/`rpr`/`atrPct` are percentages, `sri`/`mes`/`volxGap` are ratios, and
 * `tx` is a raw count.
 */
export interface SmBmIntensity {
  rsm: number | null;
  sri: number | null;
  mes: number | null;
  rpr: number | null;
  atrPct: number | null;
  volxGap: number | null;
}

export interface SmBmPanel {
  sm: number | null;
  bm: number | null;
  /** sm − bm, in Juta. */
  netCm: number | null;
  /** Consecutive sessions of positive clean money. */
  cmStreak: number | null;
  mfPlus: number | null;
  mfMinus: number | null;
  netMf: number | null;
  /** Transaction count behind the figures. */
  tx: number | null;
  intensity: SmBmIntensity;
  vwapSm: number | null;
  vwapBm: number | null;
}

/** Session-level header figures. */
export interface StockSnapshot {
  ticker: string;
  name: string;
  date: string;
  last: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  vwap: number | null;
  volume: number | null;
  value: number | null;
  frequency: number | null;
  prevClose: number | null;
  foreignBuy: number | null;
  foreignSell: number | null;
  foreignNet: number | null;
}

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Page-level data access for the non-flow pages.
 *
 * Exactly like ./index.ts: components never import a mock file, they go
 * through here. When `VITE_API_BASE` is set this hits the backend's real
 * endpoints; otherwise it serves static mocks.
 *
 * Backend endpoints (source: backend/routes/):
 *   GET /api/sector?date_from&date_to  -> SectorResponse
 *   GET /api/bsjp/signals?date         -> BsjpSignalsResponse
 *   GET /api/ohlcv?ticker&tf           -> adapted to CandleSeries (see readOhlcv)
 *   GET /api/last-date + /api/ihsg     -> adapted to MarketSnapshot
 *
 * Not served by the local backend, so a live read says so instead of showing a
 * mock figure that would pass for real:
 *   portfolio simulation  — it simulates BSJP, which is switched off locally, and
 *                           its payload shape differs from PortfolioResponse
 *   admin job status      — there is no JSON endpoint for it
 */

import type {
  AdminResponse,
  BsjpSignalsResponse,
  Candle,
  CandleSeries,
  MarketSnapshot,
  PortfolioResponse,
  SectorResponse,
} from "../types.pages";
import {
  apiBase,
  isMockMode,
  getJson,
  joinUrl,
  liveOrMock,
  readyResult,
  resolveWindow,
  unavailable,
  fetchLatestDate,
  type DataResult,
  type DataStatus,
  type DateWindow,
} from "./http";
import { mockSector } from "./mockSector";
import { mockBsjp } from "./mockBsjp";
import { getCandles } from "./mockCandles";
import { mockPortfolio } from "./mockPortfolio";
import { mockPortfolioWyckoff } from "./mockPortfolioWyckoff";
import { mockAdmin } from "./mockAdmin";
import { mockSnapshot } from "./mockSnapshot";

export { apiBase, isMockMode };
export type { DataResult, DataStatus, DateWindow };

export const fetchSector = (window?: DateWindow): Promise<DataResult<SectorResponse>> =>
  liveOrMock(
    async (base) => {
      const w = await resolveWindow(base, window);
      const params = new URLSearchParams({ date_from: w.from, date_to: w.to });
      return getJson<SectorResponse>(joinUrl(base, `/api/sector?${params.toString()}`));
    },
    () => mockSector,
  );

export const fetchBsjp = (window?: DateWindow): Promise<DataResult<BsjpSignalsResponse>> =>
  liveOrMock(
    async (base) => {
      // The scanner emits one snapshot per day, so only the window's end matters.
      const w = await resolveWindow(base, window);
      const params = new URLSearchParams({ date: w.to });
      return getJson<BsjpSignalsResponse>(joinUrl(base, `/api/bsjp/signals?${params.toString()}`));
    },
    () => mockBsjp,
  );

/* ── OHLCV ──────────────────────────────────────────────────────────── */

/** One candle as `/api/ohlcv` sends it. `datetime_wib` is `YYYY-MM-DD HH:MM`. */
interface OhlcvCandle {
  datetime_wib: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OhlcvPayload {
  ticker: string;
  tf: string;
  name?: string;
  candles: OhlcvCandle[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Keep only well-formed candles; a hole in the series is better than a NaN bar. */
export function adaptOhlcv(payload: OhlcvPayload): { name: string | null; series: CandleSeries } {
  const points: Candle[] = [];
  for (const c of payload.candles) {
    if (
      typeof c.datetime_wib !== "string" ||
      !isFiniteNumber(c.open) ||
      !isFiniteNumber(c.high) ||
      !isFiniteNumber(c.low) ||
      !isFiniteNumber(c.close)
    ) {
      continue;
    }
    points.push({
      date: c.datetime_wib.slice(0, 10),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: isFiniteNumber(c.volume) ? c.volume : 0,
    });
  }
  return {
    name: typeof payload.name === "string" && payload.name.length > 0 ? payload.name : null,
    series: { ticker: payload.ticker, tf: payload.tf, points },
  };
}

export async function readOhlcv(
  base: string,
  ticker: string,
  tf: string,
): Promise<{ name: string | null; series: CandleSeries }> {
  const params = new URLSearchParams({ ticker, tf });
  const payload = await getJson<OhlcvPayload>(joinUrl(base, `/api/ohlcv?${params.toString()}`));
  return adaptOhlcv(payload);
}

export const fetchCandles = (
  ticker: string,
  tf: string,
): Promise<DataResult<CandleSeries>> =>
  liveOrMock(
    async (base) => (await readOhlcv(base, ticker, tf)).series,
    () => getCandles(ticker, tf),
  );

/* ── Market snapshot (hub) ──────────────────────────────────────────── */

/** IDX regular trading, Mon–Fri. WIB is UTC+7 with no daylight saving. */
export function marketStatus(now: Date): MarketSnapshot["status"] {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  const day = wib.getUTCDay();
  if (day === 0 || day === 6) return "CLOSED";
  const minutes = wib.getUTCHours() * 60 + wib.getUTCMinutes();
  if (minutes >= 8 * 60 + 45 && minutes < 9 * 60) return "PRE_OPEN";
  if (minutes >= 9 * 60 && minutes < 16 * 60) return "OPEN";
  return "CLOSED";
}

function wibClock(now: Date): string {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} WIB`;
}

function ddmmyyyyToIso(d: string): string {
  const [dd, mm, yyyy] = d.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

export function adaptSnapshot(
  lastDate: string,
  ihsg: { price: number | null; gain_pct: number | null },
  now: Date,
): MarketSnapshot {
  return {
    ihsg: isFiniteNumber(ihsg.price) ? ihsg.price : null,
    ihsg_gain_pct: isFiniteNumber(ihsg.gain_pct) ? ihsg.gain_pct : null,
    as_of: ddmmyyyyToIso(lastDate),
    time: wibClock(now),
    status: marketStatus(now),
  };
}

export const fetchSnapshot = (): Promise<DataResult<MarketSnapshot>> =>
  liveOrMock(
    async (base) => {
      const [lastDate, ihsg] = await Promise.all([
        fetchLatestDate(base),
        getJson<{ price: number | null; gain_pct: number | null }>(joinUrl(base, "/api/ihsg")),
      ]);
      return adaptSnapshot(lastDate, ihsg, new Date());
    },
    () => mockSnapshot,
  );

/* ── Not served by the local backend ────────────────────────────────── */

const PORTFOLIO_WHY =
  "the portfolio simulation replays BSJP signals and BSJP is switched off on the local backend.";

export const fetchPortfolio = async (): Promise<DataResult<PortfolioResponse>> =>
  apiBase() === undefined
    ? readyResult(mockPortfolio)
    : unavailable("Portfolio", PORTFOLIO_WHY);

/**
 * The second simulated book, so the Portfolio page can compare Wyckoff against
 * BSJP. Offline it is a mock; live there is no such book.
 */
export const fetchPortfolioWyckoff = async (): Promise<DataResult<PortfolioResponse>> =>
  apiBase() === undefined
    ? readyResult(mockPortfolioWyckoff)
    : unavailable("Wyckoff portfolio", PORTFOLIO_WHY);

export const fetchAdmin = async (): Promise<DataResult<AdminResponse>> =>
  apiBase() === undefined
    ? readyResult(mockAdmin)
    : unavailable("Admin status", "the backend has no JSON endpoint for job status.");

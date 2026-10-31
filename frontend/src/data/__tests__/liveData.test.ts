import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLastDate, resolveWindow } from "../http";
import {
  adaptOhlcv,
  adaptSnapshot,
  fetchAdmin,
  fetchBsjp,
  fetchPortfolio,
  fetchPortfolioWyckoff,
  fetchSector,
  fetchSnapshot,
  marketStatus,
} from "../pages";
import {
  MAX_SESSIONS,
  assembleStock,
  buildSmBm,
  buildSnapshot,
  fetchStock,
  pickSession,
} from "../stock";
import type { FlowResponse, TickerRow } from "../../types";
import type { Candle } from "../../types.stock";

/** A fetch stub that answers by path and records every URL it was asked for. */
function routedFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (!(path in routes)) {
      return { ok: false, status: 404, statusText: "NOT FOUND", json: async () => ({}) };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => routes[path] };
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseLastDate", () => {
  it("turns the API's slash form into the dashed form every other endpoint takes", () => {
    expect(parseLastDate("30/10/2026")).toBe("30-10-2026");
  });

  it("treats an empty database (null) and anything malformed as no date", () => {
    expect(parseLastDate(null)).toBeNull();
    expect(parseLastDate(undefined)).toBeNull();
    expect(parseLastDate("30-10-2026")).toBeNull();
    expect(parseLastDate("2026/10/30")).toBeNull();
    expect(parseLastDate(20261030)).toBeNull();
  });
});

describe("resolveWindow", () => {
  it("returns the given window untouched, without a request", async () => {
    const spy = routedFetch({});
    vi.stubGlobal("fetch", spy);
    const w = { from: "01-10-2026", to: "30-10-2026" };
    expect(await resolveWindow("http://x", w)).toBe(w);
    expect(spy).not.toHaveBeenCalled();
  });

  it("falls back to the newest day, as a one-day window", async () => {
    vi.stubGlobal("fetch", routedFetch({ "/api/last-date": { date: "30/10/2026" } }));
    expect(await resolveWindow("http://x")).toEqual({ from: "30-10-2026", to: "30-10-2026" });
  });
});

describe("adaptOhlcv", () => {
  const good = {
    datetime_wib: "2026-10-30 09:00",
    open: 4950,
    high: 5000,
    low: 4900,
    close: 4980,
    volume: 1000,
  };

  it("maps the backend candle to a dated candle", () => {
    const { name, series } = adaptOhlcv({
      ticker: "BBCA",
      tf: "1d",
      name: "PT Bank Central Asia Tbk",
      candles: [good],
    });
    expect(name).toBe("PT Bank Central Asia Tbk");
    expect(series).toEqual({
      ticker: "BBCA",
      tf: "1d",
      points: [{ date: "2026-10-30", open: 4950, high: 5000, low: 4900, close: 4980, volume: 1000 }],
    });
  });

  it("drops malformed candles rather than drawing a NaN bar", () => {
    const { series } = adaptOhlcv({
      ticker: "X",
      tf: "1d",
      candles: [
        good,
        { ...good, close: Number.NaN },
        { ...good, open: null as unknown as number },
        { ...good, datetime_wib: undefined as unknown as string },
      ],
    });
    expect(series.points).toHaveLength(1);
  });

  it("has no name when the backend sent none", () => {
    expect(adaptOhlcv({ ticker: "X", tf: "1d", candles: [] }).name).toBeNull();
    expect(adaptOhlcv({ ticker: "X", tf: "1d", name: "", candles: [] }).name).toBeNull();
  });
});

describe("marketStatus (WIB, UTC+7)", () => {
  // 2026-10-30 is a Friday, 2026-10-31 a Saturday.
  const at = (iso: string) => new Date(iso);

  it("is OPEN through the trading day", () => {
    expect(marketStatus(at("2026-10-30T02:00:00Z"))).toBe("OPEN"); // 09:00 WIB
    expect(marketStatus(at("2026-10-30T08:59:00Z"))).toBe("OPEN"); // 15:59 WIB
  });

  it("is PRE_OPEN in the 15 minutes before the bell", () => {
    expect(marketStatus(at("2026-10-30T01:50:00Z"))).toBe("PRE_OPEN"); // 08:50 WIB
  });

  it("is CLOSED after the close, before dawn, and all weekend", () => {
    expect(marketStatus(at("2026-10-30T09:00:00Z"))).toBe("CLOSED"); // 16:00 WIB
    expect(marketStatus(at("2026-10-30T00:00:00Z"))).toBe("CLOSED"); // 07:00 WIB
    expect(marketStatus(at("2026-10-31T03:00:00Z"))).toBe("CLOSED"); // Saturday
    expect(marketStatus(at("2026-11-01T03:00:00Z"))).toBe("CLOSED"); // Sunday
  });

  it("reads the WIB weekday, not the UTC one", () => {
    // Friday 23:30 UTC is already Saturday 06:30 in WIB.
    expect(marketStatus(at("2026-10-30T23:30:00Z"))).toBe("CLOSED");
  });
});

describe("adaptSnapshot", () => {
  it("keeps a missing index quote null instead of inventing a value", () => {
    const s = adaptSnapshot("30-10-2026", { price: null, gain_pct: null }, new Date("2026-10-31T03:00:00Z"));
    expect(s.ihsg).toBeNull();
    expect(s.ihsg_gain_pct).toBeNull();
    expect(s.as_of).toBe("2026-10-30");
    expect(s.time).toBe("10:00 WIB");
    expect(s.status).toBe("CLOSED");
  });

  it("passes a real quote through", () => {
    const s = adaptSnapshot("30-10-2026", { price: 5057.05, gain_pct: -0.8 }, new Date("2026-10-30T03:00:00Z"));
    expect(s.ihsg).toBe(5057.05);
    expect(s.ihsg_gain_pct).toBe(-0.8);
    expect(s.status).toBe("OPEN");
  });
});

describe("live page reads", () => {
  it("asks /api/sector for an explicit window, resolved from the newest day", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const payload = { sectors: [], date_from: "30-10-2026", date_to: "30-10-2026" };
    const spy = routedFetch({ "/api/last-date": { date: "30/10/2026" }, "/api/sector": payload });
    vi.stubGlobal("fetch", spy);

    const res = await fetchSector();

    const url = String(spy.mock.calls[1]?.[0]);
    expect(url).toContain("/api/sector?");
    expect(url).toContain("date_from=30-10-2026");
    expect(url).toContain("date_to=30-10-2026");
    expect(res.data).toEqual(payload);
  });

  it("asks /api/bsjp/signals for the window's end day", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const payload = { date: "30-10-2026", count: 0, signals: [] };
    const spy = routedFetch({ "/api/bsjp/signals": payload });
    vi.stubGlobal("fetch", spy);

    const res = await fetchBsjp({ from: "29-10-2026", to: "30-10-2026" });

    expect(String(spy.mock.calls[0]?.[0])).toContain("date=30-10-2026");
    expect(res.data).toEqual(payload);
  });

  it("builds the hub snapshot from the newest day and the index quote", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    vi.stubGlobal(
      "fetch",
      routedFetch({
        "/api/last-date": { date: "30/10/2026" },
        "/api/ihsg": { price: 5057.05, gain_pct: -0.8 },
      }),
    );
    const res = await fetchSnapshot();
    expect(res.status).toBe("ready");
    expect(res.data?.ihsg).toBe(5057.05);
    expect(res.data?.as_of).toBe("2026-10-30");
  });

  it("serves portfolio and admin from mocks offline", async () => {
    expect((await fetchPortfolio()).status).toBe("ready");
    expect((await fetchPortfolioWyckoff()).status).toBe("ready");
    expect((await fetchAdmin()).status).toBe("ready");
  });

  it("says portfolio and admin are unavailable live — never a mock figure", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const spy = routedFetch({});
    vi.stubGlobal("fetch", spy);

    for (const read of [fetchPortfolio, fetchPortfolioWyckoff, fetchAdmin]) {
      const res = await read();
      expect(res.status).toBe("error");
      expect(res.data).toBeNull();
      expect(res.error).toContain("not available from this backend");
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ── Stock ──────────────────────────────────────────────────────────── */

const candle = (date: string, close: number): Candle => ({
  date,
  open: close - 10,
  high: close + 20,
  low: close - 30,
  close,
  volume: 1_000_000,
});

const SERIES: Candle[] = [
  candle("2026-10-27", 4900),
  candle("2026-10-28", 4950),
  candle("2026-10-29", 5000),
  candle("2026-10-30", 4980),
];

function row(over: Partial<TickerRow> = {}): TickerRow {
  return {
    ticker: "BBCA",
    clean_money: 1500,
    sm_val: 5000,
    bm_val: 3500,
    rsm: 58.8,
    mf_plus: 9000,
    mf_minus: 7000,
    net_mf: 2000,
    gain_pct: 0.8,
    price: 4980,
    tx: 12,
    phase: "ACCUM",
    action: "HOLD",
    watch: null,
    sri: 1.2,
    mes: 0.7,
    volx_gap: 3.1,
    rpr: 0.4,
    atr_pct: 5.3,
    sm_sma10: 4000,
    bm_sma10: 3000,
    vwap_sm: 4990,
    vwap_bm: 4930,
    ma5: 4970,
    ma13: 4990,
    ma34: 5100,
    ma200: 6000,
    rsi14: 42,
    cm_streak: 2,
    ma_structure: "Downtrend",
    narrative: null,
    ...over,
  };
}

function flowOf(rows: TickerRow[], sm: number, bm: number): FlowResponse {
  return {
    tickers: rows,
    totals: { sm, bm, mf_plus: null, mf_minus: null, net_cm: sm - bm, net_mf: null, count: rows.length },
    date_from: "30-10-2026",
    date_to: "30-10-2026",
  };
}

describe("pickSession", () => {
  it("picks the session on the date, with the one before it", () => {
    const { session, prev } = pickSession(SERIES, "2026-10-29");
    expect(session?.close).toBe(5000);
    expect(prev?.close).toBe(4950);
  });

  it("falls back to the newest session before a date with no candle", () => {
    // 2026-10-31 is a Saturday.
    expect(pickSession(SERIES, "2026-10-31").session?.date).toBe("2026-10-30");
  });

  it("has no previous session for the first candle, and no session before the series", () => {
    expect(pickSession(SERIES, "2026-10-27").prev).toBeNull();
    expect(pickSession(SERIES, "2026-01-01")).toEqual({ session: null, prev: null });
  });
});

describe("buildSnapshot", () => {
  it("derives the header figures from the session and the day before", () => {
    const s = buildSnapshot("BBCA", "PT Bank Central Asia Tbk", "2026-10-30", SERIES);
    expect(s.last).toBe(4980);
    expect(s.prevClose).toBe(5000);
    expect(s.changePct).toBe(-0.4); // (4980 - 5000) / 5000
    expect(s.open).toBe(4970);
    expect(s.volume).toBe(1_000_000);
    expect(s.date).toBe("2026-10-30");
  });

  it("leaves what the database does not hold null — never zero", () => {
    const s = buildSnapshot("BBCA", null, "2026-10-30", SERIES);
    expect(s.name).toBe("BBCA");
    for (const k of ["vwap", "value", "frequency", "foreignBuy", "foreignSell", "foreignNet"] as const) {
      expect(s[k]).toBeNull();
    }
  });

  it("has an empty header, not a crash, when there are no candles", () => {
    const s = buildSnapshot("BBCA", null, "2026-10-30", []);
    expect(s.last).toBeNull();
    expect(s.changePct).toBeNull();
    expect(s.date).toBe("2026-10-30");
  });
});

describe("buildSmBm", () => {
  it("maps the flow row onto the panel", () => {
    const p = buildSmBm(row(), true);
    expect(p.sm).toBe(5000);
    expect(p.netCm).toBe(1500);
    expect(p.cmStreak).toBe(2);
    expect(p.tx).toBe(12);
    expect(p.intensity).toEqual({ rsm: 58.8, sri: 1.2, mes: 0.7, rpr: 0.4, atrPct: 5.3, volxGap: 3.1 });
    expect(p.vwapSm).toBe(4990);
  });

  it("is unknown, not zero, on a day with no SM/BM recorded anywhere", () => {
    const p = buildSmBm(row({ sm_val: 0, bm_val: 0, clean_money: 0, tx: 0, cm_streak: -1 }), false);
    expect(p.sm).toBeNull();
    expect(p.bm).toBeNull();
    expect(p.netCm).toBeNull();
    expect(p.cmStreak).toBeNull();
    expect(p.tx).toBeNull();
    expect(p.mfPlus).toBeNull();
    // Price-derived intensity is still real on such a day.
    expect(p.intensity.atrPct).toBe(5.3);
  });

  it("is all null for a symbol the flow does not list", () => {
    const p = buildSmBm(undefined, true);
    expect(p.sm).toBeNull();
    expect(p.netCm).toBeNull();
    expect(p.intensity.atrPct).toBeNull();
  });
});

describe("assembleStock", () => {
  const w = { from: "30-10-2026", to: "30-10-2026" };

  it("combines candles and the symbol's flow row, and marks the unfed blocks missing", () => {
    const d = assembleStock("BBCA", "PT Bank Central Asia Tbk", SERIES, flowOf([row()], 100, 80), w);
    expect(d.snapshot.last).toBe(4980);
    expect(d.smBm.sm).toBe(5000);
    expect(d.tradeBook).toEqual([]);
    expect(d.brokers).toEqual([]);
    expect(d.missing).toEqual({ tradeBook: true, brokers: true });
  });

  it("treats a market-wide zero as no coverage", () => {
    const d = assembleStock("BBCA", null, SERIES, flowOf([row({ sm_val: 0, bm_val: 0 })], 0, 0), w);
    expect(d.smBm.sm).toBeNull();
  });

  it("keeps only the newest sessions of a long series", () => {
    const long = Array.from({ length: MAX_SESSIONS + 50 }, (_, i) => candle(`2000-01-${String(i)}`, 100 + i));
    const d = assembleStock("BBCA", null, long, flowOf([row()], 1, 1), w);
    expect(d.candles).toHaveLength(MAX_SESSIONS);
    expect(d.candles[d.candles.length - 1]).toBe(long[long.length - 1]);
  });
});

describe("fetchStock", () => {
  it("serves the mock offline, with nothing marked missing", async () => {
    const res = await fetchStock("DSSA");
    expect(res.status).toBe("ready");
    expect(res.data?.missing).toEqual({ tradeBook: false, brokers: false });
    expect(res.data?.tradeBook.length).toBeGreaterThan(0);
  });

  it("reads candles and flow for the window, live", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const spy = routedFetch({
      "/api/ohlcv": {
        ticker: "BBCA",
        tf: "1d",
        name: "PT Bank Central Asia Tbk",
        candles: SERIES.map((c) => ({ ...c, datetime_wib: `${c.date} 09:00` })),
      },
      "/api/flow": flowOf([row()], 100, 80),
    });
    vi.stubGlobal("fetch", spy);

    const res = await fetchStock("BBCA", { from: "30-10-2026", to: "30-10-2026" });

    expect(res.status).toBe("ready");
    expect(res.data?.snapshot.name).toBe("PT Bank Central Asia Tbk");
    expect(res.data?.snapshot.last).toBe(4980);
    expect(res.data?.smBm.sm).toBe(5000);
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/ohlcv?ticker=BBCA&tf=1d"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/flow?date_from=30-10-2026&date_to=30-10-2026"))).toBe(true);
  });

  it("reports an unknown symbol as an error carrying the 404", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    vi.stubGlobal("fetch", routedFetch({ "/api/flow": flowOf([], 1, 1) }));

    const res = await fetchStock("ZZZZ", { from: "30-10-2026", to: "30-10-2026" });

    expect(res.status).toBe("error");
    expect(res.error).toContain("404");
  });
});

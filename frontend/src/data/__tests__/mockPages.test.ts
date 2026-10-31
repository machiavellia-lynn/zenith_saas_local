/**
 * Contract tests for the non-flow page mocks (PRD US-006…US-011).
 *
 * These assert the invariants the UI and the chart library depend on, not the
 * literal numbers: that each payload is exactly its declared type, that the
 * derived fields agree with the raw ones, and that the shapes the designers
 * specified (both signs of clean money, every job status, ≥60 candles, an
 * internally consistent portfolio) are actually present.
 *
 * The consistency rules matter more than the coverage rules here. A sector row
 * whose `cm` disagrees with `sm_val - bm_val`, a signal whose stop sits above
 * its entry, or a P&L that does not match its own win rate would all render
 * without error and quietly lie to the user, which is the failure mode these
 * tests exist to catch.
 */

import { describe, it, expect } from "vitest";

import type { AdminJob, BsjpSignal, Candle, PortfolioTrade } from "../../types.pages";
import { BSJP_SETUPS } from "../../types.pages";
import { SECTORS, SECTOR_MEMBERS } from "../sectors";
import { mockSector } from "../mockSector";
import { mockBsjp, mockBsjpTickers, BSJP_SL_TYPES, BSJP_UNIVERSE } from "../mockBsjp";
import {
  mockCandles,
  getCandles,
  emptyCandles,
  CANDLE_SESSIONS,
} from "../mockCandles";
import { mockPortfolio } from "../mockPortfolio";
import { mockAdmin, ADMIN_UNIVERSE, JOB_STATUSES } from "../mockAdmin";
import { mockSnapshot } from "../mockSnapshot";

/* ── Shared helpers ──────────────────────────────────────────────────── */

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Sortable key for a DD-MM-YYYY date; lexicographic order is wrong on it. */
function dmyKey(dmy: string): number {
  const [d = "0", m = "0", y = "0"] = dmy.split("-");
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

/** Sortable key for a YYYY-MM-DD date, which does sort lexicographically. */
function ymdKey(ymd: string): number {
  const [y = "0", m = "0", d = "0"] = ymd.split("-");
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

const DMY = /^\d{2}-\d{2}-\d{4}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HMS = /^\d{2}:\d{2}:\d{2}$/;

/* ── Sector ──────────────────────────────────────────────────────────── */

describe("mockSector — response shape", () => {
  it("exposes exactly the SectorResponse top-level keys", () => {
    expect(Object.keys(mockSector).sort()).toEqual(
      ["date_from", "date_to", "sectors"].sort(),
    );
  });

  it("uses DD-MM-YYYY for date_from and date_to", () => {
    expect(mockSector.date_from).toMatch(DMY);
    expect(mockSector.date_to).toMatch(DMY);
  });

  it("has date_from not after date_to", () => {
    expect(dmyKey(mockSector.date_from)).toBeLessThanOrEqual(dmyKey(mockSector.date_to));
  });

  it("carries one row per sector in SECTORS, and no others", () => {
    expect(mockSector.sectors.length).toBe(SECTORS.length);
    expect(mockSector.sectors.map((s) => s.name).sort()).toEqual([...SECTORS].sort());
  });

  it("uses unique sector names", () => {
    const names = mockSector.sectors.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("presents every SectorRow field on every row", () => {
    const keys: readonly (keyof (typeof mockSector.sectors)[number])[] = [
      "name",
      "sm_val",
      "bm_val",
      "cm",
      "mf_plus",
      "mf_minus",
      "net_mf",
      "gain_pct",
      "ticker_count",
    ];
    for (const s of mockSector.sectors) {
      for (const k of keys) {
        expect(Object.prototype.hasOwnProperty.call(s, k), `${s.name}.${k}`).toBe(true);
      }
      expect(Object.keys(s).sort()).toEqual([...keys].sort());
    }
  });

  it("never emits NaN or undefined in a numeric slot", () => {
    for (const s of mockSector.sectors) {
      for (const v of [s.sm_val, s.bm_val, s.cm, s.ticker_count]) {
        expect(Number.isFinite(v), `${s.name} = ${v}`).toBe(true);
      }
      for (const v of [s.mf_plus, s.mf_minus, s.net_mf, s.gain_pct]) {
        if (v === null) continue;
        expect(Number.isFinite(v), `${s.name} = ${v}`).toBe(true);
      }
    }
  });
});

describe("mockSector — derived fields", () => {
  it("derives cm as sm_val - bm_val on every row", () => {
    for (const s of mockSector.sectors) {
      expect(s.cm, s.name).toBeCloseTo(round2(s.sm_val - s.bm_val), 6);
    }
  });

  it("derives net_mf as mf_plus - mf_minus wherever both sides exist", () => {
    for (const s of mockSector.sectors) {
      if (s.net_mf === null) continue;
      expect(s.mf_plus, s.name).not.toBeNull();
      expect(s.net_mf, s.name).toBeCloseTo(round2((s.mf_plus ?? 0) - (s.mf_minus ?? 0)), 6);
    }
  });

  it("keeps net_mf null only when both MF sides are missing", () => {
    for (const s of mockSector.sectors) {
      if (s.net_mf === null) {
        expect(s.mf_plus, s.name).toBeNull();
        expect(s.mf_minus, s.name).toBeNull();
      }
    }
  });

  it("sorts rows by cm descending, matching the backend", () => {
    const rows = mockSector.sectors;
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]?.cm, `row ${i}`).toBeGreaterThanOrEqual(rows[i]?.cm ?? 0);
    }
  });

  it("holds at least two sectors on each side of zero", () => {
    expect(mockSector.sectors.filter((s) => s.cm > 0).length).toBeGreaterThanOrEqual(2);
    expect(mockSector.sectors.filter((s) => s.cm < 0).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps both signs present rather than rounding one side away", () => {
    expect(mockSector.sectors.some((s) => s.cm < 0)).toBe(true);
    expect(mockSector.sectors.some((s) => s.cm > 0)).toBe(true);
  });

  it("rounds every monetary field to 2dp, as the backend rounds them", () => {
    for (const s of mockSector.sectors) {
      for (const v of [s.sm_val, s.bm_val, s.cm, s.mf_plus, s.mf_minus, s.net_mf]) {
        if (v === null) continue;
        expect(round2(v), s.name).toBeCloseTo(v, 6);
      }
    }
  });

  it("keeps mf_plus and mf_minus non-negative, and gain_pct in a sane band", () => {
    for (const s of mockSector.sectors) {
      if (s.mf_plus !== null) expect(s.mf_plus, s.name).toBeGreaterThanOrEqual(0);
      if (s.mf_minus !== null) expect(s.mf_minus, s.name).toBeGreaterThanOrEqual(0);
      if (s.gain_pct !== null) {
        expect(s.gain_pct, s.name).toBeGreaterThan(-25);
        expect(s.gain_pct, s.name).toBeLessThan(25);
      }
    }
  });
});

describe("mockSector — aggregate plausibility", () => {
  it("keeps flows in a sector-aggregate Juta range, larger than one stock", () => {
    for (const s of mockSector.sectors) {
      expect(s.sm_val, s.name).toBeGreaterThan(100_000);
      expect(s.sm_val, s.name).toBeLessThan(5_000_000);
      expect(s.bm_val, s.name).toBeGreaterThan(100_000);
      expect(s.bm_val, s.name).toBeLessThan(5_000_000);
    }
  });

  it("gives every sector a ticker count at least as large as its member sample", () => {
    for (const s of mockSector.sectors) {
      expect(Number.isInteger(s.ticker_count), s.name).toBe(true);
      expect(s.ticker_count, s.name).toBeGreaterThan(0);
      const members = SECTOR_MEMBERS[s.name] ?? [];
      expect(s.ticker_count, s.name).toBeGreaterThanOrEqual(members.length);
    }
  });

  it("uses varied values rather than uniform round numbers", () => {
    const fractional = new Set(
      mockSector.sectors.map((s) => Math.round(s.sm_val * 100) % 100),
    );
    expect(fractional.size).toBeGreaterThan(4);
  });
});

/* ── BSJP ────────────────────────────────────────────────────────────── */

const signals = mockBsjp.signals;

describe("mockBsjp — response shape", () => {
  it("exposes exactly the BsjpSignalsResponse top-level keys", () => {
    expect(Object.keys(mockBsjp).sort()).toEqual(["count", "date", "signals"].sort());
  });

  it("uses DD-MM-YYYY for the scan date", () => {
    expect(mockBsjp.date).toMatch(DMY);
  });

  it("carries 12 to 18 signals", () => {
    expect(signals.length).toBeGreaterThanOrEqual(12);
    expect(signals.length).toBeLessThanOrEqual(18);
  });

  it("sets count to the number of signals it ships", () => {
    expect(mockBsjp.count).toBe(signals.length);
  });

  it("presents every BsjpSignal field on every signal", () => {
    const keys: readonly (keyof BsjpSignal)[] = [
      "id",
      "date",
      "ticker",
      "setup",
      "entry",
      "tp1",
      "tp2",
      "sl",
      "sl_type",
      "score",
      "day_rank",
      "lot_size",
      "universe",
      "computed_at",
    ];
    for (const s of signals) {
      for (const k of keys) {
        expect(Object.prototype.hasOwnProperty.call(s, k), `${s.ticker}.${k}`).toBe(true);
      }
      expect(Object.keys(s).sort(), s.ticker).toEqual([...keys].sort());
    }
  });

  it("uses unique ids", () => {
    const ids = signals.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses a date matching the response date", () => {
    for (const s of signals) {
      expect(s.date, s.ticker).toBe(mockBsjp.date);
    }
  });
});

describe("mockBsjp — the setup closed set", () => {
  it("keeps every setup inside BSJP_SETUPS, the enabled pair", () => {
    const allowed = new Set<string>(BSJP_SETUPS);
    for (const s of signals) {
      expect(allowed.has(s.setup), `${s.ticker}: ${s.setup}`).toBe(true);
    }
  });

  it("uses more than one setup, so the column is not a constant", () => {
    expect(new Set(signals.map((s) => s.setup)).size).toBeGreaterThanOrEqual(2);
  });

  it("keeps sl_type inside the exported closed set", () => {
    const allowed = new Set<string>(BSJP_SL_TYPES);
    for (const s of signals) {
      expect(s.sl_type, s.ticker).not.toBeNull();
      expect(allowed.has(s.sl_type ?? ""), `${s.ticker}: ${s.sl_type}`).toBe(true);
    }
  });

  it("scopes every signal to the full universe", () => {
    for (const s of signals) {
      expect(s.universe, s.ticker).toBe(BSJP_UNIVERSE);
      expect(s.universe, s.ticker).toBe("full");
    }
  });

  it("stamps computed_at as an ISO timestamp", () => {
    for (const s of signals) {
      expect(s.computed_at, s.ticker).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/);
      expect(Number.isNaN(Date.parse(s.computed_at ?? "")), s.ticker).toBe(false);
    }
  });
});

describe("mockBsjp — bracket consistency", () => {
  it("orders sl < entry < tp1 < tp2 on every signal", () => {
    for (const s of signals) {
      expect(s.entry, s.ticker).not.toBeNull();
      expect(s.sl, s.ticker).not.toBeNull();
      expect(s.tp1, s.ticker).not.toBeNull();
      expect(s.tp2, s.ticker).not.toBeNull();

      const entry = s.entry ?? 0;
      const sl = s.sl ?? 0;
      const tp1 = s.tp1 ?? 0;
      const tp2 = s.tp2 ?? 0;

      expect(sl, `${s.ticker} sl < entry`).toBeLessThan(entry);
      expect(entry, `${s.ticker} entry < tp1`).toBeLessThan(tp1);
      expect(tp1, `${s.ticker} tp1 < tp2`).toBeLessThan(tp2);
    }
  });

  it("quotes prices as whole rupiah", () => {
    for (const s of signals) {
      for (const v of [s.entry, s.tp1, s.tp2, s.sl]) {
        expect(Number.isInteger(v), `${s.ticker} = ${v}`).toBe(true);
        expect(v ?? 0, s.ticker).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the bracket within a few percent of entry, as the strategy does", () => {
    for (const s of signals) {
      const entry = s.entry ?? 0;
      const slPct = ((s.sl ?? 0) - entry) / entry;
      const tp2Pct = ((s.tp2 ?? 0) - entry) / entry;
      expect(slPct, s.ticker).toBeLessThan(0);
      expect(slPct, s.ticker).toBeGreaterThan(-0.1);
      expect(tp2Pct, s.ticker).toBeGreaterThan(0);
      expect(tp2Pct, s.ticker).toBeLessThan(0.1);
    }
  });

  it("keeps score a fraction in [0, 1]", () => {
    for (const s of signals) {
      expect(s.score, s.ticker).not.toBeNull();
      expect(s.score ?? -1, s.ticker).toBeGreaterThanOrEqual(0);
      expect(s.score ?? 2, s.ticker).toBeLessThanOrEqual(1);
    }
  });

  it("keeps lot_size a positive whole number of lots", () => {
    for (const s of signals) {
      expect(Number.isInteger(s.lot_size), s.ticker).toBe(true);
      expect(s.lot_size ?? 0, s.ticker).toBeGreaterThan(0);
    }
  });
});

describe("mockBsjp — ranking", () => {
  it("numbers day_rank 1..n, ascending and unique", () => {
    const ranks = signals.map((s) => s.day_rank);
    for (const r of ranks) {
      expect(r, "rank present").not.toBeNull();
      expect(Number.isInteger(r), `rank ${r}`).toBe(true);
    }
    expect(ranks).toEqual(signals.map((_, i) => i + 1));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("lists signals in day_rank order, as the backend orders them", () => {
    for (let i = 1; i < signals.length; i += 1) {
      expect(signals[i - 1]?.day_rank ?? 0, `row ${i}`).toBeLessThan(signals[i]?.day_rank ?? 0);
    }
  });

  it("never repeats a (ticker, setup) pair", () => {
    const pairs = signals.map((s) => `${s.ticker}|${s.setup}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("uses IDX-shaped ticker symbols", () => {
    for (const s of signals) {
      expect(s.ticker, s.ticker).toMatch(/^[A-Z]{4}$/);
    }
  });

  it("keeps the exported ticker list aligned with the signals", () => {
    expect(mockBsjpTickers).toEqual(signals.map((s) => s.ticker));
  });
});

/* ── Candles ─────────────────────────────────────────────────────────── */

const seriesList = Object.values(mockCandles);

describe("mockCandles — coverage", () => {
  it("carries at least six tickers", () => {
    expect(seriesList.length).toBeGreaterThanOrEqual(6);
  });

  it("includes BBRI explicitly, as the chart page requires", () => {
    expect(mockCandles.BBRI).toBeDefined();
    expect(mockCandles.BBRI?.ticker).toBe("BBRI");
  });

  it("keys every series by its own ticker", () => {
    for (const [key, series] of Object.entries(mockCandles)) {
      expect(series.ticker, key).toBe(key);
    }
  });

  it("labels every keyed series with a timeframe", () => {
    for (const series of seriesList) {
      expect(series.tf, series.ticker).toBe("1D");
    }
  });

  it("gives every series at least 60 candles", () => {
    for (const series of seriesList) {
      expect(series.points.length, series.ticker).toBeGreaterThanOrEqual(60);
    }
    expect(CANDLE_SESSIONS).toBeGreaterThanOrEqual(60);
  });

  it("uses unique dates within each series", () => {
    for (const series of seriesList) {
      const dates = series.points.map((p) => p.date);
      expect(new Set(dates).size, series.ticker).toBe(dates.length);
    }
  });
});

describe("mockCandles — OHLC invariants", () => {
  it("keeps low <= min(open, close) on every candle", () => {
    for (const series of seriesList) {
      for (const c of series.points) {
        expect(c.low, `${series.ticker} ${c.date}`).toBeLessThanOrEqual(Math.min(c.open, c.close));
      }
    }
  });

  it("keeps high >= max(open, close) on every candle", () => {
    for (const series of seriesList) {
      for (const c of series.points) {
        expect(c.high, `${series.ticker} ${c.date}`).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      }
    }
  });

  it("keeps high >= low on every candle", () => {
    for (const series of seriesList) {
      for (const c of series.points) {
        expect(c.high, `${series.ticker} ${c.date}`).toBeGreaterThanOrEqual(c.low);
      }
    }
  });

  it("keeps volume strictly positive on every candle", () => {
    for (const series of seriesList) {
      for (const c of series.points) {
        expect(Number.isInteger(c.volume), `${series.ticker} ${c.date}`).toBe(true);
        expect(c.volume, `${series.ticker} ${c.date}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every price a positive whole number of rupiah", () => {
    for (const series of seriesList) {
      for (const c of series.points) {
        for (const v of [c.open, c.high, c.low, c.close]) {
          expect(Number.isInteger(v), `${series.ticker} ${c.date} = ${v}`).toBe(true);
          expect(v, `${series.ticker} ${c.date}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("mockCandles — date axis", () => {
  it("formats every date as YYYY-MM-DD", () => {
    for (const series of seriesList) {
      for (const c of series.points) {
        expect(c.date, series.ticker).toMatch(YMD);
      }
    }
  });

  it("orders every series' dates ascending", () => {
    for (const series of seriesList) {
      for (let i = 1; i < series.points.length; i += 1) {
        const prev = series.points[i - 1] as Candle;
        const curr = series.points[i] as Candle;
        expect(ymdKey(curr.date), `${series.ticker} ${prev.date} -> ${curr.date}`).toBeGreaterThan(
          ymdKey(prev.date),
        );
      }
    }
  });

  it("skips weekends, since IDX does not trade them", () => {
    for (const series of seriesList) {
      for (const c of series.points) {
        const day = new Date(ymdKey(c.date)).getUTCDay();
        expect(day, `${series.ticker} ${c.date}`).not.toBe(0);
        expect(day, `${series.ticker} ${c.date}`).not.toBe(6);
      }
    }
  });
});

describe("mockCandles — determinism and lookup", () => {
  it("generates at least 360 candles in total", () => {
    const total = seriesList.reduce((n, s) => n + s.points.length, 0);
    expect(total).toBeGreaterThanOrEqual(360);
  });

  it("reproduces the same series on repeated reads", () => {
    const first = getCandles("BBRI", "1D");
    const second = getCandles("BBRI", "1D");
    expect(second).toBe(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(mockCandles.BBRI));
  });

  it("returns a real series for every keyed ticker", () => {
    for (const [key, series] of Object.entries(mockCandles)) {
      expect(getCandles(key, "1D"), key).toBe(series);
    }
  });

  it("returns an empty series for an unknown ticker rather than undefined", () => {
    const result = getCandles("ZZZZ", "1D");
    expect(result).toBeDefined();
    expect(result).toEqual({ ticker: "ZZZZ", tf: "1D", points: [] });
    expect(result.points).toEqual([]);
  });

  it("never throws for an unknown ticker, whatever the timeframe", () => {
    for (const tf of ["", "1D", "5M", "1W", "nonsense"]) {
      expect(() => getCandles("NOTATICKER", tf), tf).not.toThrow();
    }
  });

  it("echoes the requested ticker and timeframe on a miss", () => {
    expect(getCandles("ZZZZ", "5M")).toEqual({ ticker: "ZZZZ", tf: "5M", points: [] });
  });

  it("falls back to an empty series for a timeframe the mock does not carry", () => {
    const result = getCandles("BBRI", "5M");
    expect(result.points).toEqual([]);
    expect(result.ticker).toBe("BBRI");
    expect(result.tf).toBe("5M");
  });

  it("builds the empty series the same way for any input", () => {
    expect(emptyCandles("ZZZZ", "1D")).toEqual({ ticker: "ZZZZ", tf: "1D", points: [] });
  });
});

/* ── Portfolio ───────────────────────────────────────────────────────── */

const pf = mockPortfolio;
const closedTrades = pf.trades.filter((t) => t.status === "CLOSED");
const openTrades = pf.trades.filter((t) => t.status === "OPEN");

describe("mockPortfolio — response shape", () => {
  it("exposes exactly the PortfolioResponse top-level keys", () => {
    expect(Object.keys(pf).sort()).toEqual(
      ["summary", "equity_curve", "trades", "date_from", "date_to"].sort(),
    );
  });

  it("uses DD-MM-YYYY for date_from and date_to", () => {
    expect(pf.date_from).toMatch(DMY);
    expect(pf.date_to).toMatch(DMY);
  });

  it("carries 15 to 25 trades", () => {
    expect(pf.trades.length).toBeGreaterThanOrEqual(15);
    expect(pf.trades.length).toBeLessThanOrEqual(25);
  });

  it("mixes OPEN and CLOSED trades", () => {
    expect(closedTrades.length).toBeGreaterThan(0);
    expect(openTrades.length).toBeGreaterThan(0);
  });

  it("uses unique trade ids", () => {
    const ids = pf.trades.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("presents every PortfolioTrade field on every trade", () => {
    const keys: readonly (keyof PortfolioTrade)[] = [
      "id",
      "ticker",
      "setup",
      "entry_date",
      "exit_date",
      "entry",
      "exit",
      "lots",
      "pnl",
      "pnl_pct",
      "status",
      "phase",
    ];
    for (const t of pf.trades) {
      for (const k of keys) {
        expect(Object.prototype.hasOwnProperty.call(t, k), `${t.ticker}#${t.id}.${k}`).toBe(true);
      }
      expect(Object.keys(t).sort(), `${t.ticker}#${t.id}`).toEqual([...keys].sort());
    }
  });

  it("closes only trades that carry an exit date and exit price", () => {
    for (const t of closedTrades) {
      expect(t.exit_date, `${t.ticker}#${t.id}`).not.toBeNull();
      expect(t.exit, `${t.ticker}#${t.id}`).not.toBeNull();
      expect(t.exit_date, t.ticker).toMatch(DMY);
    }
  });

  it("leaves OPEN trades without an exit date", () => {
    for (const t of openTrades) {
      expect(t.exit_date, `${t.ticker}#${t.id}`).toBeNull();
    }
  });

  it("keeps entry_date ≤ exit_date on every closed trade", () => {
    for (const t of closedTrades) {
      expect(dmyKey(t.entry_date), `${t.ticker}#${t.id}`).toBeLessThanOrEqual(
        dmyKey(t.exit_date ?? t.entry_date),
      );
    }
  });

  it("keeps lots a positive whole number and prices whole rupiah", () => {
    for (const t of pf.trades) {
      expect(Number.isInteger(t.lots), `${t.ticker}#${t.id}`).toBe(true);
      expect(t.lots, `${t.ticker}#${t.id}`).toBeGreaterThan(0);
      expect(Number.isInteger(t.entry), `${t.ticker}#${t.id}`).toBe(true);
      expect(t.entry, `${t.ticker}#${t.id}`).toBeGreaterThan(0);
    }
  });

  it("uses setups drawn from a small, stable set", () => {
    const allowed = new Set(["SMA5_BREAKOUT_V13", "POWER_BREAK_V21"]);
    for (const t of pf.trades) {
      expect(allowed.has(t.setup), `${t.ticker}#${t.id}: ${t.setup}`).toBe(true);
    }
  });
});

describe("mockPortfolio — summary agrees with trades", () => {
  it("counts exactly the trades in the ledger", () => {
    expect(pf.summary.trades).toBe(pf.trades.length);
  });

  it("counts wins as closed trades with pnl > 0", () => {
    const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
    expect(pf.summary.wins).toBe(wins.length);
  });

  it("counts losses as the remaining closed trades", () => {
    const losses = closedTrades.filter((t) => (t.pnl ?? 0) <= 0);
    expect(pf.summary.losses).toBe(losses.length);
  });

  it("accounts for every closed trade across wins and losses", () => {
    expect(pf.summary.wins + pf.summary.losses).toBe(closedTrades.length);
  });

  it("excludes OPEN trades from the realised outcome counts", () => {
    expect(pf.summary.wins + pf.summary.losses).toBeLessThan(pf.summary.trades);
  });

  it("sums total_pnl from the closed trades", () => {
    const expected = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    expect(pf.summary.total_pnl).toBeCloseTo(expected, 4);
  });

  it("reports win_rate as a 0-100 percentage consistent with wins over closed trades", () => {
    // The reference backend emits a percentage (algo_portfolio.py), and
    // PortfolioPage renders it through formatPct without rescaling. A 0-1
    // fraction here would display as 0.64% instead of 63.6%.
    const expectedPct = (pf.summary.wins / closedTrades.length) * 100;
    expect(pf.summary.win_rate).toBeGreaterThanOrEqual(0);
    expect(pf.summary.win_rate).toBeLessThanOrEqual(100);
    expect(pf.summary.win_rate).toBeCloseTo(expectedPct, 1);
    // Guard the exact bug that was here: the value must not be a bare fraction.
    expect(pf.summary.win_rate).toBeGreaterThan(1);
  });

  it("keeps the equity identity equity = starting_capital + total_pnl", () => {
    expect(pf.summary.equity).toBeCloseTo(
      pf.summary.starting_capital + pf.summary.total_pnl,
      4,
    );
  });

  it("keeps total_pnl_pct consistent with total_pnl over starting capital", () => {
    expect(pf.summary.total_pnl_pct).toBeCloseTo(
      round2((pf.summary.total_pnl / pf.summary.starting_capital) * 100),
      2,
    );
  });

  it("makes profit_factor a positive finite ratio", () => {
    expect(pf.summary.profit_factor).not.toBeNull();
    expect(pf.summary.profit_factor ?? 0).toBeGreaterThan(0);
  });

  it("signs avg_win_pct positive and avg_loss_pct negative", () => {
    expect(pf.summary.avg_win_pct).toBeGreaterThan(0);
    expect(pf.summary.avg_loss_pct).toBeLessThan(0);
  });

  it("computes pnl_pct from entry and exit on every trade", () => {
    for (const t of pf.trades) {
      if (t.exit === null) continue;
      expect(t.pnl_pct, `${t.ticker}#${t.id}`).toBeCloseTo(
        round2(((t.exit - t.entry) / t.entry) * 100),
        2,
      );
    }
  });

  it("computes pnl in Rp as lots × 100 shares × (exit − entry)", () => {
    for (const t of pf.trades) {
      if (t.exit === null) continue;
      expect(t.pnl, `${t.ticker}#${t.id}`).toBeCloseTo(t.lots * 100 * (t.exit - t.entry), 4);
    }
  });

  it("signs pnl and pnl_pct the same way on every trade", () => {
    for (const t of pf.trades) {
      if (t.exit === null) continue;
      expect(Math.sign(t.pnl ?? 0), `${t.ticker}#${t.id}`).toBe(Math.sign(t.pnl_pct ?? 0));
    }
  });
});

describe("mockPortfolio — equity curve", () => {
  it("carries at least 40 points", () => {
    expect(pf.equity_curve.length).toBeGreaterThanOrEqual(40);
  });

  it("orders points ascending by date", () => {
    const curve = pf.equity_curve;
    for (let i = 1; i < curve.length; i += 1) {
      const prev = curve[i - 1];
      const curr = curve[i];
      if (prev === undefined || curr === undefined) throw new Error("hole in the curve");
      expect(dmyKey(curr.date), `${prev.date} -> ${curr.date}`).toBeGreaterThan(dmyKey(prev.date));
    }
  });

  it("formats every curve date as DD-MM-YYYY", () => {
    for (const p of pf.equity_curve) {
      expect(p.date, p.date).toMatch(DMY);
    }
  });

  it("keeps drawdown_pct at or below zero everywhere", () => {
    for (const p of pf.equity_curve) {
      expect(p.drawdown_pct, p.date).toBeLessThanOrEqual(0);
    }
  });

  it("starts the curve at the starting capital", () => {
    expect(pf.equity_curve[0]?.equity).toBe(pf.summary.starting_capital);
    expect(pf.equity_curve[0]?.drawdown_pct).toBe(0);
  });

  it("ends the curve at the summary's equity", () => {
    expect(pf.equity_curve[pf.equity_curve.length - 1]?.equity).toBeCloseTo(pf.summary.equity, 4);
  });

  it("spans the summary's date range", () => {
    expect(pf.equity_curve[0]?.date).toBe(pf.date_from);
    expect(pf.equity_curve[pf.equity_curve.length - 1]?.date).toBe(pf.date_to);
  });

  it("keeps every equity value positive and finite", () => {
    for (const p of pf.equity_curve) {
      expect(Number.isFinite(p.equity), p.date).toBe(true);
      expect(p.equity, p.date).toBeGreaterThan(0);
    }
  });

  it("shows at least one genuine drawdown, so the shaded region is exercised", () => {
    expect(pf.equity_curve.some((p) => p.drawdown_pct < 0)).toBe(true);
  });
});

describe("mockPortfolio — max drawdown", () => {
  it("equals the worst drawdown in the curve", () => {
    const worst = pf.equity_curve.reduce((min, p) => Math.min(min, p.drawdown_pct), 0);
    expect(pf.summary.max_drawdown_pct).toBeCloseTo(worst, 4);
  });

  it("is negative, since the curve does dip below a peak", () => {
    expect(pf.summary.max_drawdown_pct).toBeLessThan(0);
  });

  it("matches a peak-to-trough walk over the equity series", () => {
    let peak: number | null = null;
    let worst = 0;
    for (const p of pf.equity_curve) {
      if (peak === null || p.equity > peak) peak = p.equity;
      const dd = round2(((p.equity - peak) / peak) * 100);
      if (dd < worst) worst = dd;
    }
    expect(pf.summary.max_drawdown_pct).toBeCloseTo(worst, 2);
  });
});

/* ── Admin ───────────────────────────────────────────────────────────── */

describe("mockAdmin — response shape", () => {
  it("exposes exactly the AdminResponse top-level keys", () => {
    expect(Object.keys(mockAdmin).sort()).toEqual(
      ["jobs", "counts", "universe", "last_ingest"].sort(),
    );
  });

  it("carries 6 to 10 jobs", () => {
    expect(mockAdmin.jobs.length).toBeGreaterThanOrEqual(6);
    expect(mockAdmin.jobs.length).toBeLessThanOrEqual(10);
  });

  it("scopes the book to the full universe", () => {
    expect(mockAdmin.universe).toBe("full");
    expect(mockAdmin.universe).toBe(ADMIN_UNIVERSE);
  });

  it("uses unique job keys", () => {
    const keys = mockAdmin.jobs.map((j) => j.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("presents every AdminJob field on every job", () => {
    const keys: readonly (keyof AdminJob)[] = [
      "key",
      "name",
      "description",
      "schedule",
      "status",
      "last_run",
      "last_result",
      "rows",
    ];
    for (const j of mockAdmin.jobs) {
      for (const k of keys) {
        expect(Object.prototype.hasOwnProperty.call(j, k), `${j.key}.${k}`).toBe(true);
      }
      expect(Object.keys(j).sort(), j.key).toEqual([...keys].sort());
    }
  });

  it("gives every job a human-readable name and description", () => {
    for (const j of mockAdmin.jobs) {
      expect(j.name.length, j.key).toBeGreaterThan(3);
      expect(j.description.length, j.key).toBeGreaterThan(10);
      expect(j.schedule.length, j.key).toBeGreaterThan(3);
    }
  });

  it("uses realistic job names", () => {
    const names = mockAdmin.jobs.map((j) => j.name);
    for (const expected of ["Daily ingest", "EOD summary rebuild", "BSJP scan"]) {
      expect(names, expected).toContain(expected);
    }
    expect(names.some((n) => n.toLowerCase().includes("weekly"))).toBe(true);
  });
});

describe("mockAdmin — job statuses", () => {
  it("keeps every status inside the JobStatus closed set", () => {
    const allowed = new Set<string>(JOB_STATUSES);
    for (const j of mockAdmin.jobs) {
      expect(allowed.has(j.status), `${j.key}: ${j.status}`).toBe(true);
    }
  });

  it("covers all four statuses at least once", () => {
    for (const status of ["idle", "running", "ok", "failed"] as const) {
      expect(
        mockAdmin.jobs.filter((j) => j.status === status).length,
        `status ${status}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps last_run on a DD-MM-YYYY HH:MM stamp wherever it is set", () => {
    for (const j of mockAdmin.jobs) {
      if (j.last_run === null) continue;
      expect(j.last_run, j.key).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
    }
  });

  it("keeps last_result null only when the job has never run", () => {
    for (const j of mockAdmin.jobs) {
      if (j.last_run === null) expect(j.last_result, j.key).toBeNull();
    }
  });
});

describe("mockAdmin — counts", () => {
  it("declares exactly the four count keys", () => {
    expect(Object.keys(mockAdmin.counts).sort()).toEqual(
      ["eod_summary", "raw_messages", "bsjp_signals", "tickers"].sort(),
    );
  });

  it("keeps every count a positive integer", () => {
    for (const [key, value] of Object.entries(mockAdmin.counts)) {
      expect(Number.isInteger(value), key).toBe(true);
      expect(value, key).toBeGreaterThan(0);
    }
  });

  it("keeps the counts in a plausible order of magnitude", () => {
    expect(mockAdmin.counts.tickers).toBeGreaterThan(100);
    expect(mockAdmin.counts.tickers).toBeLessThan(2_000);
    expect(mockAdmin.counts.eod_summary).toBeGreaterThan(mockAdmin.counts.tickers);
    expect(mockAdmin.counts.raw_messages).toBeGreaterThan(mockAdmin.counts.eod_summary);
    expect(mockAdmin.counts.bsjp_signals).toBeGreaterThan(0);
  });

  it("keeps job row counts positive whole numbers wherever set", () => {
    for (const j of mockAdmin.jobs) {
      if (j.rows === null) continue;
      expect(Number.isInteger(j.rows), j.key).toBe(true);
      expect(j.rows, j.key).toBeGreaterThan(0);
    }
  });

  it("stamps last_ingest as a DD-MM-YYYY HH:MM date-time", () => {
    expect(mockAdmin.last_ingest).not.toBeNull();
    expect(mockAdmin.last_ingest ?? "").toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
  });
});

/* ── Snapshot ────────────────────────────────────────────────────────── */

describe("mockSnapshot", () => {
  it("exposes exactly the MarketSnapshot keys", () => {
    expect(Object.keys(mockSnapshot).sort()).toEqual(
      ["ihsg", "ihsg_gain_pct", "as_of", "time", "status"].sort(),
    );
  });

  it("keeps IHSG a number in the 7,000-7,800 band the hub is designed for", () => {
    expect(typeof mockSnapshot.ihsg).toBe("number");
    expect(Number.isFinite(mockSnapshot.ihsg)).toBe(true);
    expect(mockSnapshot.ihsg).toBeGreaterThanOrEqual(7_000);
    expect(mockSnapshot.ihsg).toBeLessThanOrEqual(7_800);
  });

  it("carries a plausible daily gain", () => {
    const gain = mockSnapshot.ihsg_gain_pct;
    // The live type allows null (quote unavailable); the mock always has a value.
    expect(gain).not.toBeNull();
    expect(Number.isFinite(gain)).toBe(true);
    expect(Math.abs(gain ?? Number.NaN)).toBeLessThan(5);
    expect(gain).not.toBe(0);
  });

  it("formats as_of as YYYY-MM-DD", () => {
    expect(mockSnapshot.as_of).toMatch(YMD);
    expect(Number.isNaN(ymdKey(mockSnapshot.as_of))).toBe(false);
  });

  it("formats time as HH:MM:SS", () => {
    expect(mockSnapshot.time).toMatch(HMS);
    const [h = "0", m = "0", s = "0"] = mockSnapshot.time.split(":");
    expect(Number(h), "hours").toBeLessThan(24);
    expect(Number(m), "minutes").toBeLessThan(60);
    expect(Number(s), "seconds").toBeLessThan(60);
  });

  it("uses a status from the closed set", () => {
    expect(["OPEN", "CLOSED", "PRE_OPEN"]).toContain(mockSnapshot.status);
  });

  it("uses a close-of-session time, matching a CLOSED market", () => {
    const [h = "0"] = mockSnapshot.time.split(":");
    if (mockSnapshot.status === "CLOSED") {
      expect(Number(h), "IDX closes at 16:00 WIB").toBeGreaterThanOrEqual(16);
    }
  });
});

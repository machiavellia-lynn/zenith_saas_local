/**
 * Contract tests for the mock flow dataset (PRD US-004).
 *
 * These assert the properties the UI depends on, not the literal numbers:
 * that the payload is exactly a `FlowResponse`, that its `totals` agree with
 * its rows, and that the coverage the design was built against is present.
 */

import { describe, it, expect } from "vitest";

import { PHASES } from "../../types";
import type { TickerRow } from "../../types";
import { mockFlow } from "../mockFlow";

/** Every key `TickerRow` declares — the shape the UI may index by name. */
const REQUIRED_KEYS: readonly (keyof TickerRow)[] = [
  "ticker",
  "clean_money",
  "sm_val",
  "bm_val",
  "rsm",
  "mf_plus",
  "mf_minus",
  "net_mf",
  "gain_pct",
  "price",
  "tx",
  "phase",
  "action",
  "watch",
  "sri",
  "mes",
  "volx_gap",
  "rpr",
  "atr_pct",
  "sm_sma10",
  "bm_sma10",
  "vwap_sm",
  "vwap_bm",
  "ma5",
  "ma13",
  "ma34",
  "ma200",
  "rsi14",
  "cm_streak",
  "ma_structure",
  "narrative",
];

/** totalled the same way routes_flow.py L271-284 does. */
function sumOf(rows: readonly TickerRow[], pick: (r: TickerRow) => number | null): number {
  let total = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v !== null) total += v;
  }
  return Math.round(total * 100) / 100;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const tickers = mockFlow.tickers;

function withPhase(phase: string): TickerRow[] {
  return tickers.filter((t) => t.phase === phase);
}

describe("mockFlow — response shape", () => {
  it("exposes exactly the FlowResponse top-level keys", () => {
    expect(Object.keys(mockFlow).sort()).toEqual(
      ["date_from", "date_to", "tickers", "totals"].sort(),
    );
  });

  it("carries a non-empty ticker array", () => {
    expect(Array.isArray(mockFlow.tickers)).toBe(true);
    expect(tickers.length).toBeGreaterThan(0);
  });

  it("uses DD-MM-YYYY for date_from and date_to", () => {
    const dmy = /^\d{2}-\d{2}-\d{4}$/;
    expect(mockFlow.date_from).toMatch(dmy);
    expect(mockFlow.date_to).toMatch(dmy);
  });

  it("has date_from not after date_to", () => {
    // Parse manually: DD-MM-YYYY is not a Date constructor format.
    const parse = (s: string): number => {
      const [d = "0", m = "0", y = "0"] = s.split("-");
      return Date.UTC(Number(y), Number(m) - 1, Number(d));
    };
    expect(parse(mockFlow.date_from)).toBeLessThanOrEqual(parse(mockFlow.date_to));
  });

  it("declares exactly the FlowTotals keys", () => {
    expect(Object.keys(mockFlow.totals).sort()).toEqual(
      ["sm", "bm", "mf_plus", "mf_minus", "net_cm", "net_mf", "count"].sort(),
    );
  });

  it("has decimals at 2dp on every monetary field, as the backend rounds them", () => {
    for (const t of tickers) {
      for (const v of [t.sm_val, t.bm_val, t.clean_money, t.vwap_sm, t.vwap_bm]) {
        if (v === null) continue;
        expect(round2(v)).toBeCloseTo(v, 6);
      }
    }
  });

  it("presents every TickerRow field on every ticker", () => {
    for (const t of tickers) {
      for (const key of REQUIRED_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(t, key), `${t.ticker}.${key}`).toBe(true);
      }
      // No trailing undefined masquerading as a present field.
      expect(Object.keys(t).sort()).toEqual([...REQUIRED_KEYS].sort());
    }
  });

  it("never emits NaN or undefined in a numeric slot", () => {
    for (const t of tickers) {
      for (const key of REQUIRED_KEYS) {
        const v: unknown = t[key];
        expect(v, `${t.ticker}.${key}`).not.toBeUndefined();
        if (typeof v === "number") {
          expect(Number.isFinite(v), `${t.ticker}.${key} = ${v}`).toBe(true);
        }
      }
    }
  });
});

describe("mockFlow — totals consistency", () => {
  it("counts every ticker", () => {
    expect(mockFlow.totals.count).toBe(tickers.length);
  });

  it("sums totals.sm from the non-null sm_val fields", () => {
    expect(mockFlow.totals.sm).toBeCloseTo(sumOf(tickers, (r) => r.sm_val), 2);
  });

  it("sums totals.bm from the non-null bm_val fields", () => {
    expect(mockFlow.totals.bm).toBeCloseTo(sumOf(tickers, (r) => r.bm_val), 2);
  });

  it("sums totals.net_cm from the non-null clean_money fields", () => {
    expect(mockFlow.totals.net_cm).toBeCloseTo(sumOf(tickers, (r) => r.clean_money), 2);
  });

  it("keeps net_cm equal to sm - bm across the whole book", () => {
    expect(mockFlow.totals.net_cm).toBeCloseTo(mockFlow.totals.sm - mockFlow.totals.bm, 2);
  });

  it("derives clean_money as sm_val - bm_val on every row", () => {
    for (const t of tickers) {
      if (t.sm_val === null || t.bm_val === null) {
        expect(t.clean_money, t.ticker).toBeNull();
      } else {
        expect(t.clean_money, t.ticker).toBeCloseTo(t.sm_val - t.bm_val, 6);
      }
    }
  });
});

describe("mockFlow — coverage rules from US-004", () => {
  it("holds at least 60 tickers", () => {
    expect(tickers.length).toBeGreaterThanOrEqual(60);
  });

  it("uses unique ticker symbols", () => {
    const symbols = tickers.map((t) => t.ticker);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("uses real IDX symbols", () => {
    const symbols = new Set(tickers.map((t) => t.ticker));
    for (const expected of ["BBCA", "BBRI", "BMRI", "TLKM", "ASII", "GOTO", "ANTM"]) {
      expect(symbols.has(expected), expected).toBe(true);
    }
    for (const s of symbols) {
      expect(s, s).toMatch(/^[A-Z]{4}$/);
    }
  });

  it("renders every phase in the closed vocabulary at least once", () => {
    for (const phase of PHASES) {
      expect(withPhase(phase).length, `phase ${phase}`).toBeGreaterThan(0);
    }
  });

  it("introduces no phase outside the vocabulary", () => {
    const allowed = new Set<string>(PHASES);
    for (const t of tickers) {
      if (t.phase === null) continue;
      expect(allowed.has(t.phase), `${t.ticker}: ${t.phase}`).toBe(true);
    }
  });
});

describe("mockFlow — the missing-data paths", () => {
  it("has at least one ticker with no analytics (null phase and null action)", () => {
    const noAnalytics = tickers.filter((t) => t.phase === null && t.action === null);
    expect(noAnalytics.length).toBeGreaterThanOrEqual(1);
  });

  it("has at least one ticker whose flow totals are withheld (null clean_money)", () => {
    expect(tickers.some((t) => t.clean_money === null)).toBe(true);
  });

  it("nulls sm_val and bm_val wherever clean_money is null", () => {
    for (const t of tickers.filter((r) => r.clean_money === null)) {
      expect(t.sm_val, t.ticker).toBeNull();
      expect(t.bm_val, t.ticker).toBeNull();
    }
  });

  it("has a no-flow ticker that still reports NEUTRAL / HOLD, as the backend does", () => {
    // routes_flow.py L194-197 nulls the totals on the `_nodata` path, while
    // L212-214 still sets phase="NEUTRAL", action="HOLD".
    const noFlow = tickers.filter(
      (t) => t.sm_val === null && t.bm_val === null && t.clean_money === null && t.rsm === null,
    );
    expect(noFlow.length).toBeGreaterThanOrEqual(1);
    expect(noFlow.some((t) => t.phase === "NEUTRAL" && t.action === "HOLD")).toBe(true);
  });

  it("nulls rsm whenever it cannot be computed, and keeps it in [0, 100] otherwise", () => {
    for (const t of tickers) {
      if (t.rsm === null) continue;
      expect(t.rsm, t.ticker).toBeGreaterThanOrEqual(0);
      expect(t.rsm, t.ticker).toBeLessThanOrEqual(100);
    }
    for (const t of tickers.filter((r) => r.sm_val === null || r.bm_val === null)) {
      expect(t.rsm, t.ticker).toBeNull();
    }
  });

  it("keeps rsm consistent with sm_val and bm_val where both are present", () => {
    for (const t of tickers) {
      if (t.sm_val === null || t.bm_val === null || t.rsm === null) continue;
      const total = t.sm_val + t.bm_val;
      if (total <= 0) continue;
      expect(t.rsm, t.ticker).toBeCloseTo(round2((t.sm_val / total) * 1000) / 10, 1);
    }
  });
});

describe("mockFlow — distribution of values", () => {
  it("has at least one positive clean_money", () => {
    expect(tickers.some((t) => (t.clean_money ?? 0) > 0)).toBe(true);
  });

  it("has at least one negative clean_money", () => {
    expect(tickers.some((t) => (t.clean_money ?? 0) < 0)).toBe(true);
  });

  it("keeps outflows out of the null bucket — negatives are real values, not missing ones", () => {
    const negatives = tickers.filter((t) => (t.clean_money ?? 0) < 0);
    for (const t of negatives) {
      expect(t.sm_val, t.ticker).not.toBeNull();
      expect(t.bm_val, t.ticker).not.toBeNull();
    }
  });

  it("keeps money values in a plausible Juta range for IDX blue chips", () => {
    for (const t of tickers) {
      for (const v of [t.sm_val, t.bm_val]) {
        if (v === null) continue;
        expect(v, t.ticker).toBeGreaterThan(0);
        // Nothing on the IDX trades a full 5 trillion IDR of net flow a day.
        expect(v, t.ticker).toBeLessThan(2_000_000);
      }
    }
  });

  it("uses varied values rather than uniform round numbers", () => {
    const values = tickers
      .map((t) => t.sm_val)
      .filter((v): v is number => v !== null);
    expect(values.length).toBeGreaterThanOrEqual(60);
    // A dataset of round numbers would have far fewer distinct fractional parts.
    const fractional = new Set(values.map((v) => Math.round(v * 100) % 100));
    expect(fractional.size).toBeGreaterThan(20);
  });

  it("sorts rows by clean_money descending with nulls last, matching the backend", () => {
    const values = tickers.map((t) => t.clean_money);
    const firstNull = values.findIndex((v) => v === null);
    const nonNull = firstNull === -1 ? values : values.slice(0, firstNull);

    for (let i = 1; i < nonNull.length; i += 1) {
      const prev = nonNull[i - 1];
      const curr = nonNull[i];
      if (prev === null || prev === undefined || curr === null || curr === undefined) {
        throw new Error("unexpected null before the null boundary");
      }
      expect(prev, `row ${i}`).toBeGreaterThanOrEqual(curr);
    }

    if (firstNull !== -1) {
      expect(values.slice(firstNull).every((v) => v === null)).toBe(true);
    }
  });
});

describe("mockFlow — narrative coverage", () => {
  it("includes at least one narrative long enough to need truncation (150+ chars)", () => {
    const long = tickers.filter((t) => t.narrative !== null && t.narrative.length > 150);
    expect(long.length).toBeGreaterThanOrEqual(1);
  });

  it("writes narratives in Indonesian, not English placeholder text", () => {
    const withNarrative = tickers.filter((t) => t.narrative !== null);
    expect(withNarrative.length).toBeGreaterThanOrEqual(5);
    for (const t of withNarrative) {
      // Indonesian discourse markers; English placeholders would not match.
      expect(t.narrative, t.ticker).toMatch(/\b(dan|yang|dengan|tidak|harga|SM|BM)\b/);
    }
  });

  it("leaves some narratives null so the panel's empty state is exercised", () => {
    expect(tickers.some((t) => t.narrative === null)).toBe(true);
  });
});

describe("mockFlow — domain vocabulary", () => {
  it("keeps action within the backend's closed set", () => {
    const allowed = new Set(["BUY", "SELL", "HOLD"]);
    for (const t of tickers) {
      if (t.action === null) continue;
      expect(allowed.has(t.action), `${t.ticker}: ${t.action}`).toBe(true);
    }
  });

  it("keeps watch within the backend's closed set", () => {
    for (const t of tickers) {
      if (t.watch === null) continue;
      expect(t.watch, t.ticker).toBe("ARB_SPRING");
    }
  });

  it("keeps ma_structure within the eight v3.1 structure types", () => {
    const allowed = new Set([
      "Strong Uptrend",
      "Strong Downtrend",
      "Transitional Uptrend",
      "Transitional Correction",
      "Cluster on Macro Uptrend",
      "Cluster on Macro Downtrend",
      "Bullish Messy",
      "Bearish Messy",
    ]);
    for (const t of tickers) {
      if (t.ma_structure === null) continue;
      expect(allowed.has(t.ma_structure), `${t.ticker}: ${t.ma_structure}`).toBe(true);
    }
  });

  it("derives mes as |gain_pct| / sri, and nulls it when sri is not positive", () => {
    for (const t of tickers) {
      if (t.mes === null) {
        const ok = t.gain_pct === null || t.sri === null || t.sri <= 0;
        expect(ok, `${t.ticker} should not be able to compute mes`).toBe(true);
      } else {
        expect(t.gain_pct, t.ticker).not.toBeNull();
        expect(t.sri, t.ticker).toBeGreaterThan(0);
        expect(t.mes, t.ticker).toBeCloseTo(
          round2(Math.abs(t.gain_pct as number) / (t.sri as number)),
          2,
        );
      }
    }
  });

  it("keeps tx a non-negative integer count", () => {
    for (const t of tickers) {
      expect(Number.isInteger(t.tx), t.ticker).toBe(true);
      expect(t.tx, t.ticker).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps rpr within [0, 1] as a ratio of total transactions", () => {
    for (const t of tickers) {
      if (t.rpr === null) continue;
      expect(t.rpr, t.ticker).toBeGreaterThanOrEqual(0);
      expect(t.rpr, t.ticker).toBeLessThanOrEqual(1);
    }
  });
});

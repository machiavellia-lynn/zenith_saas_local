import { describe, it, expect } from "vitest";
import type { TickerRow } from "../../types";
import {
  DEFAULT_SORT,
  compareRows,
  defaultDirFor,
  nextSort,
  sortRows,
  type SortState,
} from "../sort";

/** Minimal row builder — only the fields under test need real values. */
function row(ticker: string, over: Partial<TickerRow> = {}): TickerRow {
  return {
    ticker,
    clean_money: null,
    sm_val: null,
    bm_val: null,
    rsm: null,
    mf_plus: null,
    mf_minus: null,
    net_mf: null,
    gain_pct: null,
    price: null,
    tx: 0,
    phase: null,
    action: null,
    watch: null,
    sri: null,
    mes: null,
    volx_gap: null,
    rpr: null,
    atr_pct: null,
    sm_sma10: null,
    bm_sma10: null,
    vwap_sm: null,
    vwap_bm: null,
    ma5: null,
    ma13: null,
    ma34: null,
    ma200: null,
    rsi14: null,
    cm_streak: null,
    ma_structure: null,
    narrative: null,
    ...over,
  };
}

describe("default sort", () => {
  it("matches the backend ordering: clean_money descending", () => {
    expect(DEFAULT_SORT).toEqual({ key: "clean_money", dir: "desc" });
  });
});

describe("sortRows", () => {
  const rows = [
    row("AAA", { clean_money: 100 }),
    row("BBB", { clean_money: 300 }),
    row("CCC", { clean_money: null }),
    row("DDD", { clean_money: -50 }),
  ];

  it("sorts numeric descending", () => {
    const out = sortRows(rows, { key: "clean_money", dir: "desc" });
    expect(out.map((r) => r.ticker)).toEqual(["BBB", "AAA", "DDD", "CCC"]);
  });

  it("sorts numeric ascending", () => {
    const out = sortRows(rows, { key: "clean_money", dir: "asc" });
    expect(out.map((r) => r.ticker)).toEqual(["DDD", "AAA", "BBB", "CCC"]);
  });

  it("keeps nulls last in BOTH directions", () => {
    const asc = sortRows(rows, { key: "clean_money", dir: "asc" });
    const desc = sortRows(rows, { key: "clean_money", dir: "desc" });
    expect(asc[asc.length - 1]!.ticker).toBe("CCC");
    expect(desc[desc.length - 1]!.ticker).toBe("CCC");
  });

  it("does not mutate the input array", () => {
    const original = [...rows];
    sortRows(rows, { key: "clean_money", dir: "desc" });
    expect(rows.map((r) => r.ticker)).toEqual(original.map((r) => r.ticker));
  });

  it("sorts tickers case-insensitively", () => {
    const mixed = [row("bbca"), row("ASII"), row("tlkm")];
    const out = sortRows(mixed, { key: "ticker", dir: "asc" });
    expect(out.map((r) => r.ticker)).toEqual(["ASII", "bbca", "tlkm"]);
  });

  it("is deterministic for equal values", () => {
    const dupes = [row("ZZZ", { clean_money: 5 }), row("AAA", { clean_money: 5 })];
    const out = sortRows(dupes, { key: "clean_money", dir: "desc" });
    expect(out.map((r) => r.ticker)).toEqual(["AAA", "ZZZ"]);
  });
});

describe("nextSort", () => {
  it("toggles direction on the same column", () => {
    const s: SortState = { key: "rsm", dir: "desc" };
    expect(nextSort(s, "rsm")).toEqual({ key: "rsm", dir: "asc" });
    expect(nextSort({ key: "rsm", dir: "asc" }, "rsm")).toEqual({
      key: "rsm",
      dir: "desc",
    });
  });

  it("starts numeric columns descending and text ascending", () => {
    expect(nextSort(DEFAULT_SORT, "sri")).toEqual({ key: "sri", dir: "desc" });
    expect(nextSort(DEFAULT_SORT, "ticker")).toEqual({ key: "ticker", dir: "asc" });
    expect(defaultDirFor("tx")).toBe("desc");
    expect(defaultDirFor("phase")).toBe("asc");
  });
});

describe("compareRows", () => {
  it("treats two nulls as equal by value and falls back to ticker", () => {
    const a = row("A");
    const b = row("B");
    expect(compareRows(a, b, DEFAULT_SORT)).toBeLessThan(0);
  });
});

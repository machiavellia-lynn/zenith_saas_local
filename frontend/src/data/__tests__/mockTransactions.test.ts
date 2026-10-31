/**
 * Contract tests for the mock transaction tapes (PRD US-005).
 *
 * The behaviour that matters is the miss: `getTransactions` must hand the UI a
 * defined empty tape for any unknown ticker, never `undefined` and never a
 * throw, so the detail panel has something to render.
 */

import { describe, it, expect } from "vitest";

import type { TransactionRow } from "../../types";
import { getTransactions, mockTransactions, SIGNALS } from "../mockTransactions";
import { mockFlow } from "../mockFlow";

/** Every key `TransactionRow` declares. */
const ROW_KEYS: readonly (keyof TransactionRow)[] = [
  "date",
  "time",
  "price",
  "gain_pct",
  "mf",
  "mf_num",
  "vol_x",
  "signal",
];

const DMY = /^\d{2}-\d{2}-\d{4}$/;
const HMS = /^\d{2}:\d{2}:\d{2}$/;

const entries = Object.entries(mockTransactions);

describe("mockTransactions — coverage", () => {
  it("provides tapes for at least 5 tickers", () => {
    expect(entries.length).toBeGreaterThanOrEqual(5);
  });

  it("keys every tape by a ticker that exists in mockFlow", () => {
    const known = new Set(mockFlow.tickers.map((t) => t.ticker));
    for (const [key] of entries) {
      expect(known.has(key), key).toBe(true);
    }
  });

  it("names each tape's `ticker` field after its key", () => {
    for (const [key, tape] of entries) {
      expect(tape.ticker, key).toBe(key);
    }
  });

  it("splits every tape into at least 12 rows across sm and bm", () => {
    for (const [key, tape] of entries) {
      const total = tape.sm.length + tape.bm.length;
      expect(total, `${key} total rows`).toBeGreaterThanOrEqual(12);
      expect(tape.sm.length, `${key} sm rows`).toBeGreaterThanOrEqual(1);
      expect(tape.bm.length, `${key} bm rows`).toBeGreaterThanOrEqual(1);
    }
  });

  it("reports counts that match the arrays it shipped", () => {
    for (const [key, tape] of entries) {
      expect(tape.sm_count, `${key}.sm_count`).toBe(tape.sm.length);
      expect(tape.bm_count, `${key}.bm_count`).toBe(tape.bm.length);
    }
  });
});

describe("mockTransactions — row shape", () => {
  const allRows: [string, TransactionRow][] = entries.flatMap(([key, tape]) =>
    [...tape.sm, ...tape.bm].map((r): [string, TransactionRow] => [key, r]),
  );

  it("presents every TransactionRow field on every row", () => {
    for (const [key, row] of allRows) {
      for (const field of ROW_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(row, field), `${key}.${field}`).toBe(true);
      }
      expect(Object.keys(row).sort()).toEqual([...ROW_KEYS].sort());
    }
  });

  it("formats date as DD-MM-YYYY", () => {
    for (const [key, row] of allRows) {
      expect(row.date, key).toMatch(DMY);
    }
  });

  it("formats time as HH:MM:SS", () => {
    for (const [key, row] of allRows) {
      expect(row.time, key).toMatch(HMS);
    }
  });

  it("keeps every time inside the IDX session", () => {
    for (const [key, row] of allRows) {
      expect(row.time >= "09:00:00" && row.time <= "16:00:00", `${key} ${row.time}`).toBe(true);
    }
  });

  it("orders each tape newest-day-first, and by ascending time within a day", () => {
    // The backend returns one tape across the requested range ordered by
    // TO_DATE(date) then time (routes_flow.py L315). The mock presents the
    // same range newest-day-first so the panel opens on the latest session.
    const dayKey = (r: TransactionRow): string => {
      const [d = "00", m = "00", y = "0000"] = r.date.split("-");
      return `${y}-${m}-${d}`;
    };
    for (const [ticker, tape] of entries) {
      for (const side of [tape.sm, tape.bm]) {
        for (let i = 1; i < side.length; i += 1) {
          const prev = side[i - 1];
          const curr = side[i];
          if (!prev || !curr) throw new Error("index access out of range");
          const sameDay = dayKey(prev) === dayKey(curr);
          if (sameDay) {
            // Within a session, time runs forward.
            expect(prev.time <= curr.time, `${ticker} row ${i} time order`).toBe(true);
          } else {
            // Across days, the most recent day comes first.
            expect(dayKey(prev) > dayKey(curr), `${ticker} row ${i} day order`).toBe(true);
          }
        }
      }
    }
  });

  it("never emits NaN or undefined in a numeric slot", () => {
    for (const [key, row] of allRows) {
      for (const field of ROW_KEYS) {
        const v: unknown = row[field];
        expect(v, `${key}.${field}`).not.toBeUndefined();
        if (typeof v === "number") {
          expect(Number.isFinite(v), `${key}.${field}`).toBe(true);
        }
      }
    }
  });

  it("keeps prices whole rupiah, as the backend rounds them", () => {
    for (const [key, row] of allRows) {
      if (row.price === null) continue;
      expect(Number.isInteger(row.price), `${key} ${row.price}`).toBe(true);
      expect(row.price, key).toBeGreaterThan(0);
    }
  });

  it("pairs the raw mf string with a numeric mf_num of the same sign", () => {
    for (const [key, row] of allRows) {
      expect(row.mf, key).not.toBeNull();
      expect(row.mf_num, key).not.toBeNull();
      const mf = row.mf ?? "";
      const num = row.mf_num ?? 0;
      expect(mf, key).toMatch(/^[+-][\d.]+[MB]$/);
      expect(mf.startsWith("+"), `${key} ${mf} vs ${num}`).toBe(num >= 0);
    }
  });
});

describe("mockTransactions — signal vocabulary", () => {
  it("keeps every signal inside the exported closed set", () => {
    const allowed = new Set<string>(SIGNALS);
    for (const [key, tape] of entries) {
      for (const row of [...tape.sm, ...tape.bm]) {
        expect(row.signal, `${key} ${row.time}`).not.toBeNull();
        expect(allowed.has(row.signal ?? ""), `${key}: ${row.signal}`).toBe(true);
      }
    }
  });

  it("exercises more than one signal tier so the UI is not built against a constant", () => {
    const used = new Set<string>();
    for (const [, tape] of entries) {
      for (const row of [...tape.sm, ...tape.bm]) {
        if (row.signal !== null) used.add(row.signal);
      }
    }
    expect(used.size).toBeGreaterThanOrEqual(3);
  });
});

describe("mockTransactions — sm/bm split", () => {
  it("nets each tape's mf_num to the sign of its clean money in mockFlow", () => {
    const byTicker = new Map(mockFlow.tickers.map((t) => [t.ticker, t]));
    for (const [key, tape] of entries) {
      const row = byTicker.get(key);
      if (!row || row.clean_money === null) continue;
      const smSum = tape.sm.reduce((a, r) => a + (r.mf_num ?? 0), 0);
      const bmSum = tape.bm.reduce((a, r) => a + (r.mf_num ?? 0), 0);
      // SM prints are recorded positive, BM prints negative.
      expect(smSum, `${key} sm should be net positive`).toBeGreaterThan(0);
      expect(bmSum, `${key} bm should be net negative`).toBeLessThan(0);
      expect(Math.sign(row.clean_money), key).toBe(Math.sign(smSum + bmSum));
    }
  });
});

describe("getTransactions — the miss path", () => {
  it("returns an empty tape, not undefined, for an unknown ticker", () => {
    const result = getTransactions("NOT_A_TICKER");
    expect(result).toBeDefined();
    expect(result.ticker).toBe("NOT_A_TICKER");
    expect(result.sm).toEqual([]);
    expect(result.bm).toEqual([]);
  });

  it("returns zero counts for an unknown ticker", () => {
    const result = getTransactions("NOT_A_TICKER");
    expect(result.sm_count).toBe(0);
    expect(result.bm_count).toBe(0);
  });

  it("does not throw for empty, lowercase, or whitespace input", () => {
    expect(() => getTransactions("")).not.toThrow();
    expect(() => getTransactions("   ")).not.toThrow();
    expect(getTransactions("").sm).toEqual([]);
    // Lookup is exact and case-sensitive; a lowercase miss is still a safe miss.
    expect(getTransactions("bbca").sm).toEqual([]);
  });

  it("never returns a shared mutable singleton across misses", () => {
    const a = getTransactions("NOPE_1");
    const b = getTransactions("NOPE_2");
    expect(a).not.toBe(b);
    a.sm.push({
      date: "01-01-2000",
      time: "09:00:00",
      price: 1,
      gain_pct: 0,
      mf: "+1.0M",
      mf_num: 1,
      vol_x: 1,
      signal: "SMALL",
    });
    expect(b.sm).toEqual([]);
    expect(getTransactions("NOPE_2").sm).toEqual([]);
  });

  it("returns the real tape, with rows, for a known ticker", () => {
    const first = entries[0];
    expect(first).toBeDefined();
    const [key] = first as [string, unknown];
    const tape = getTransactions(key);
    expect(tape.ticker).toBe(key);
    expect(tape.sm.length + tape.bm.length).toBeGreaterThanOrEqual(12);
  });

  it("is safe for every ticker in mockFlow, tapered or not", () => {
    for (const t of mockFlow.tickers) {
      const tape = getTransactions(t.ticker);
      expect(tape.ticker, t.ticker).toBe(t.ticker);
      expect(Array.isArray(tape.sm), t.ticker).toBe(true);
      expect(Array.isArray(tape.bm), t.ticker).toBe(true);
      expect(tape.sm_count, t.ticker).toBe(tape.sm.length);
      expect(tape.bm_count, t.ticker).toBe(tape.bm.length);
    }
  });
});

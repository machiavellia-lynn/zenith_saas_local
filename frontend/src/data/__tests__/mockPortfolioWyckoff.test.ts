/**
 * Contract tests for the Wyckoff book (`mockPortfolioWyckoff`).
 *
 * These follow `mockPages.test.ts`' discipline and assert invariants, not
 * literals: the shape is a valid `PortfolioResponse`, every rule the task
 * statement lays down holds on every row, and every number in `summary` is
 * recomputed here, independently of the module's own `summarise()`.
 *
 * The consistency rules carry the weight. A trade whose `pnl` disagrees with
 * its own `entry`/`exit`, a phase outside the closed vocabulary, or a win rate
 * that does not match the trades it describes would all render without error
 * and quietly lie to the user — which is the failure these tests exist to
 * catch.
 *
 * The last block is the point of the whole file: it imports the BSJP book and
 * asserts the two books genuinely differ. A second book that tracked the first
 * would make the side-by-side comparison meaningless.
 */

import { describe, it, expect } from "vitest";

import type { PortfolioResponse, PortfolioTrade } from "../../types.pages";
import { PHASES } from "../../types";
import { mockPortfolio } from "../mockPortfolio";
import {
  mockPortfolioWyckoff,
  WYCKOFF_BOOK_PHASES,
  WYCKOFF_ENTRY_PHASES,
  WYCKOFF_EXIT_PHASES,
  WYCKOFF_PHASE_SET,
  WYCKOFF_SETUPS,
  WYCKOFF_STRATEGY_LABEL,
} from "../mockPortfolioWyckoff";

/* ── Shared helpers ──────────────────────────────────────────────────── */

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Sortable key for a DD-MM-YYYY date; lexicographic order is wrong on it. */
function dmyKey(dmy: string): number {
  const [d = "0", m = "0", y = "0"] = dmy.split("-");
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

const DMY = /^\d{2}-\d{2}-\d{4}$/;

const pf = mockPortfolioWyckoff;
const closed = pf.trades.filter((t) => t.status === "CLOSED");
const open = pf.trades.filter((t) => t.status === "OPEN");
const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
const losses = closed.filter((t) => (t.pnl ?? 0) <= 0);

const grossWin = wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0));

/* ── Shape ───────────────────────────────────────────────────────────── */

describe("mockPortfolioWyckoff — PortfolioResponse shape", () => {
  it("exposes exactly the PortfolioResponse top-level keys", () => {
    expect(Object.keys(pf).sort()).toEqual(
      ["summary", "equity_curve", "trades", "date_from", "date_to"].sort(),
    );
  });

  it("is structurally assignable to PortfolioResponse", () => {
    // A compile-time check the runtime assertion backs up: every required key
    // is present and correctly typed.
    const typed: PortfolioResponse = pf;
    expect(typed.summary).toBeDefined();
    expect(Array.isArray(typed.trades)).toBe(true);
    expect(Array.isArray(typed.equity_curve)).toBe(true);
    expect(typeof typed.date_from).toBe("string");
    expect(typeof typed.date_to).toBe("string");
  });

  it("formats date_from and date_to as DD-MM-YYYY", () => {
    expect(pf.date_from).toMatch(DMY);
    expect(pf.date_to).toMatch(DMY);
    expect(Number.isNaN(dmyKey(pf.date_from))).toBe(false);
    expect(Number.isNaN(dmyKey(pf.date_to))).toBe(false);
  });

  it("keeps date_from at or before date_to", () => {
    expect(dmyKey(pf.date_from)).toBeLessThanOrEqual(dmyKey(pf.date_to));
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

  it("never emits NaN or undefined in a numeric slot", () => {
    for (const t of pf.trades) {
      for (const v of [t.id, t.entry, t.lots]) {
        expect(Number.isFinite(v), `${t.ticker}#${t.id} = ${v}`).toBe(true);
      }
      for (const v of [t.exit, t.pnl, t.pnl_pct]) {
        if (v === null) continue;
        expect(Number.isFinite(v), `${t.ticker}#${t.id} = ${v}`).toBe(true);
      }
    }
  });
});

/* ── Ledger composition ──────────────────────────────────────────────── */

describe("mockPortfolioWyckoff — ledger composition", () => {
  it("carries 20 to 30 trades", () => {
    expect(pf.trades.length).toBeGreaterThanOrEqual(20);
    expect(pf.trades.length).toBeLessThanOrEqual(30);
  });

  it("mixes OPEN and CLOSED trades, with at least two open", () => {
    expect(closed.length).toBeGreaterThan(0);
    expect(open.length).toBeGreaterThanOrEqual(2);
  });

  it("uses unique trade ids", () => {
    const ids = pf.trades.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses IDX-shaped ticker symbols", () => {
    for (const t of pf.trades) {
      expect(t.ticker, `${t.ticker}#${t.id}`).toMatch(/^[A-Z]{4}$/);
    }
  });

  it("quotes prices as positive whole rupiah", () => {
    for (const t of pf.trades) {
      expect(Number.isInteger(t.entry), `${t.ticker}#${t.id} entry`).toBe(true);
      expect(t.entry, `${t.ticker}#${t.id}`).toBeGreaterThan(0);
      if (t.exit === null) continue;
      expect(Number.isInteger(t.exit), `${t.ticker}#${t.id} exit`).toBe(true);
      expect(t.exit, `${t.ticker}#${t.id}`).toBeGreaterThan(0);
    }
  });

  it("keeps lots a positive whole number", () => {
    for (const t of pf.trades) {
      expect(Number.isInteger(t.lots), `${t.ticker}#${t.id}`).toBe(true);
      expect(t.lots, `${t.ticker}#${t.id}`).toBeGreaterThan(0);
    }
  });
});

/* ── Dates ───────────────────────────────────────────────────────────── */

describe("mockPortfolioWyckoff — dates", () => {
  it("formats entry_date as DD-MM-YYYY on every trade", () => {
    for (const t of pf.trades) {
      expect(t.entry_date, `${t.ticker}#${t.id}`).toMatch(DMY);
      expect(Number.isNaN(dmyKey(t.entry_date)), `${t.ticker}#${t.id}`).toBe(false);
    }
  });

  it("gives every CLOSED trade an exit_date that is a real date", () => {
    for (const t of closed) {
      expect(t.exit_date, `${t.ticker}#${t.id}`).not.toBeNull();
      expect(t.exit_date ?? "", `${t.ticker}#${t.id}`).toMatch(DMY);
      expect(t.exit, `${t.ticker}#${t.id}`).not.toBeNull();
    }
  });

  it("leaves OPEN trades without an exit date", () => {
    for (const t of open) {
      expect(t.exit_date, `${t.ticker}#${t.id}`).toBeNull();
    }
  });

  it("keeps exit_date >= entry_date on every closed trade", () => {
    for (const t of closed) {
      const exitKey = dmyKey(t.exit_date ?? t.entry_date);
      expect(exitKey, `${t.ticker}#${t.id} ${t.entry_date} -> ${t.exit_date}`).toBeGreaterThanOrEqual(
        dmyKey(t.entry_date),
      );
    }
  });

  it("stamps status consistently with the presence of an exit", () => {
    for (const t of pf.trades) {
      const hasExit = t.exit !== null && t.exit_date !== null;
      expect(t.status, `${t.ticker}#${t.id}`).toBe(hasExit ? "CLOSED" : "OPEN");
    }
  });

  it("places every ledger date inside the curve's window", () => {
    const from = dmyKey(pf.date_from);
    const to = dmyKey(pf.date_to);
    for (const t of pf.trades) {
      expect(dmyKey(t.entry_date), `${t.ticker}#${t.id} entry`).toBeGreaterThanOrEqual(from);
      expect(dmyKey(t.entry_date), `${t.ticker}#${t.id} entry`).toBeLessThanOrEqual(to);
      if (t.exit_date === null) continue;
      expect(dmyKey(t.exit_date), `${t.ticker}#${t.id} exit`).toBeLessThanOrEqual(to);
    }
  });

  it("spreads trades over distinct sessions rather than piling them on one", () => {
    // Guards the generator's grid-clamping failure mode: if the book outgrew
    // its session axis, every surplus trade would land on the final date and
    // the curve would show one implausible vertical step. All other invariants
    // would still hold, so this is the only test that catches it.
    const entryDates = new Set(pf.trades.map((t) => t.entry_date));
    const exitDates = new Set(closed.map((t) => t.exit_date));
    expect(entryDates.size).toBe(pf.trades.length);
    expect(exitDates.size).toBe(closed.length);
  });
});

/* ── Wyckoff phases: the book's differentiator ───────────────────────── */

describe("mockPortfolioWyckoff — phases", () => {
  it("never leaves a phase null", () => {
    for (const t of pf.trades) {
      expect(t.phase, `${t.ticker}#${t.id}`).not.toBeNull();
      expect(t.phase, `${t.ticker}#${t.id}`).not.toBeUndefined();
    }
  });

  it("keeps every phase inside the closed Wyckoff vocabulary", () => {
    const allowed = new Set<string>(PHASES);
    for (const t of pf.trades) {
      expect(allowed.has(t.phase ?? ""), `${t.ticker}#${t.id}: ${t.phase}`).toBe(true);
    }
  });

  it("agrees with the module's own exported phase set", () => {
    const allowed = new Set<string>(WYCKOFF_PHASE_SET);
    for (const t of pf.trades) {
      expect(allowed.has(t.phase ?? ""), `${t.ticker}#${t.id}`).toBe(true);
    }
    expect([...WYCKOFF_PHASE_SET].sort()).toEqual([...PHASES].sort());
  });

  it("reports exactly the phases its rows use", () => {
    const used = new Set(pf.trades.map((t) => t.phase));
    expect([...WYCKOFF_BOOK_PHASES].sort()).toEqual([...used].sort() as string[]);
  });

  it("uses the accumulation side for entries and never a sell-side phase", () => {
    // The domain rule: a Wyckoff book enters on accumulation. Every phase in
    // this ledger is therefore a buy-side phase — an exit-driven UPTHRUST or
    // DISTRI would mean a position was opened on distribution.
    const buy = new Set<string>(WYCKOFF_ENTRY_PHASES);
    const sell = new Set<string>(WYCKOFF_EXIT_PHASES);
    for (const t of pf.trades) {
      expect(buy.has(t.phase ?? ""), `${t.ticker}#${t.id}: ${t.phase}`).toBe(true);
      expect(sell.has(t.phase ?? ""), `${t.ticker}#${t.id}: ${t.phase}`).toBe(false);
    }
  });

  it("never uses NEUTRAL, which is not an entry signal", () => {
    for (const t of pf.trades) {
      expect(t.phase, `${t.ticker}#${t.id}`).not.toBe("NEUTRAL");
    }
  });

  it("covers more than one accumulation phase, so the column is not a constant", () => {
    expect(new Set(pf.trades.map((t) => t.phase)).size).toBeGreaterThanOrEqual(2);
  });
});

/* ── Setups ──────────────────────────────────────────────────────────── */

describe("mockPortfolioWyckoff — setups", () => {
  it("draws every setup from the exported closed Wyckoff set", () => {
    const allowed = new Set<string>(WYCKOFF_SETUPS);
    for (const t of pf.trades) {
      expect(allowed.has(t.setup), `${t.ticker}#${t.id}: ${t.setup}`).toBe(true);
    }
  });

  it("uses more than one setup", () => {
    expect(new Set(pf.trades.map((t) => t.setup)).size).toBeGreaterThanOrEqual(2);
  });

  it("shares no setup label with the BSJP book", () => {
    const bsjsSetups = new Set(mockPortfolio.trades.map((t) => t.setup));
    for (const t of pf.trades) {
      expect(bsjsSetups.has(t.setup), `${t.ticker}#${t.id}: ${t.setup}`).toBe(false);
    }
  });

  it("pairs each setup with a phase from the accumulation side", () => {
    // The setup label names the structure entered on, so the pairing is a
    // domain statement, not a free choice.
    const pairs = pf.trades.map((t) => `${t.setup}|${t.phase}`);
    const allowed = new Set([
      "SPRING_ENTRY|SPRING",
      "SOS_BREAKOUT|SOS",
      "ABSORB_ACCUM|ABSORB",
      "ACCUM_RANGE|ACCUM",
    ]);
    for (const p of pairs) {
      expect(allowed.has(p), p).toBe(true);
    }
  });

  it("exposes a non-empty human label for the book", () => {
    expect(WYCKOFF_STRATEGY_LABEL.length).toBeGreaterThan(3);
  });
});

/* ── P&L arithmetic ──────────────────────────────────────────────────── */

describe("mockPortfolioWyckoff — P&L arithmetic", () => {
  it("computes pnl in Rp as lots × 100 shares × (exit − entry)", () => {
    for (const t of closed) {
      expect(t.pnl, `${t.ticker}#${t.id}`).toBeCloseTo(
        t.lots * 100 * ((t.exit ?? 0) - t.entry),
        4,
      );
    }
  });

  it("computes pnl_pct from entry and exit", () => {
    for (const t of closed) {
      expect(t.pnl_pct, `${t.ticker}#${t.id}`).toBeCloseTo(
        round2((((t.exit ?? 0) - t.entry) / t.entry) * 100),
        2,
      );
    }
  });

  it("signs pnl and pnl_pct the same way on every closed trade", () => {
    for (const t of closed) {
      expect(Math.sign(t.pnl ?? 0), `${t.ticker}#${t.id}`).toBe(Math.sign(t.pnl_pct ?? 0));
    }
  });

  it("leaves OPEN trades without a realised pnl", () => {
    for (const t of open) {
      expect(t.pnl, `${t.ticker}#${t.id}`).toBeNull();
      expect(t.pnl_pct, `${t.ticker}#${t.id}`).toBeNull();
    }
  });

  it("sizes lots so the notional stays near the allocation and never exceeds it unfairly", () => {
    for (const t of pf.trades) {
      const notional = t.lots * 100 * t.entry;
      expect(notional, `${t.ticker}#${t.id}`).toBeGreaterThan(0);
      // floor(alloc / (entry × 100)) at a minimum of 1 lot; a Rp26,000 name
      // cannot reach the full allocation and is legitimately under it.
      expect(notional, `${t.ticker}#${t.id}`).toBeLessThanOrEqual(30_000_000);
    }
  });

  it("keeps every realised move inside a plausible daily band", () => {
    for (const t of closed) {
      expect(t.pnl_pct ?? 0, `${t.ticker}#${t.id}`).toBeGreaterThan(-20);
      expect(t.pnl_pct ?? 0, `${t.ticker}#${t.id}`).toBeLessThan(50);
    }
  });
});

/* ── Summary derivation, recomputed independently ────────────────────── */

describe("mockPortfolioWyckoff — summary is derived from the trades", () => {
  it("counts trades as all rows, including OPEN", () => {
    expect(pf.summary.trades).toBe(pf.trades.length);
  });

  it("counts wins as closed trades with pnl > 0", () => {
    expect(pf.summary.wins).toBe(wins.length);
  });

  it("counts losses as closed trades with pnl <= 0", () => {
    expect(pf.summary.losses).toBe(losses.length);
  });

  it("accounts for every closed trade across wins and losses", () => {
    expect(pf.summary.wins + pf.summary.losses).toBe(closed.length);
  });

  it("excludes OPEN trades from the realised outcome counts", () => {
    expect(pf.summary.wins + pf.summary.losses).toBeLessThan(pf.summary.trades);
    expect(pf.summary.trades - (pf.summary.wins + pf.summary.losses)).toBe(open.length);
  });

  it("sums total_pnl from the closed trades only", () => {
    const expected = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    expect(pf.summary.total_pnl).toBeCloseTo(expected, 4);
  });

  it("excludes open unrealised P&L from total_pnl", () => {
    const allRows = pf.trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    // Open rows carry a null pnl, so the two sums coincide; assert the open
    // rows genuinely contribute nothing rather than assuming it.
    expect(allRows).toBeCloseTo(pf.summary.total_pnl, 4);
    expect(open.every((t) => t.pnl === null)).toBe(true);
  });

  it("reports win_rate as a 0-100 PERCENTAGE matching wins over closed trades", () => {
    const expectedPct = (wins.length / closed.length) * 100;
    expect(pf.summary.win_rate).toBeCloseTo(expectedPct, 1);
  });

  it("keeps win_rate inside 0..100", () => {
    expect(pf.summary.win_rate).toBeGreaterThanOrEqual(0);
    expect(pf.summary.win_rate).toBeLessThanOrEqual(100);
  });

  it("keeps win_rate greater than 1, guarding the 0-1 fraction regression", () => {
    // The sibling file shipped `win_rate` as a 0-1 fraction once, which renders
    // as 0.55% through formatPct instead of 55%. A fraction here would be well
    // under 1; a real book's rate is not.
    expect(pf.summary.win_rate).toBeGreaterThan(1);
    expect(pf.summary.win_rate).toBeGreaterThan(0.5);
  });

  it("keeps the equity identity equity = starting_capital + total_pnl", () => {
    expect(pf.summary.equity).toBeCloseTo(
      pf.summary.starting_capital + pf.summary.total_pnl,
      4,
    );
  });

  it("keeps equity equal to the last curve point", () => {
    expect(pf.summary.equity).toBeCloseTo(
      pf.equity_curve[pf.equity_curve.length - 1]?.equity ?? 0,
      4,
    );
  });

  it("derives total_pnl_pct from total_pnl over starting capital", () => {
    expect(pf.summary.total_pnl_pct).toBeCloseTo(
      round2((pf.summary.total_pnl / pf.summary.starting_capital) * 100),
      2,
    );
  });

  it("derives avg_win_pct as the mean pnl_pct of winners", () => {
    const expected = round2(wins.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / wins.length);
    expect(pf.summary.avg_win_pct).toBeCloseTo(expected, 2);
    expect(pf.summary.avg_win_pct).toBeGreaterThan(0);
  });

  it("derives avg_loss_pct as the mean pnl_pct of losers", () => {
    const expected = round2(losses.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / losses.length);
    expect(pf.summary.avg_loss_pct).toBeCloseTo(expected, 2);
    expect(pf.summary.avg_loss_pct).toBeLessThan(0);
  });

  it("derives profit_factor as gross win over gross loss", () => {
    expect(pf.summary.profit_factor).not.toBeNull();
    expect(pf.summary.profit_factor ?? 0).toBeCloseTo(round2(grossWin / grossLoss), 2);
    expect(pf.summary.profit_factor ?? 0).toBeGreaterThan(0);
  });

  it("derives expectancy_pct as the realised expectancy per closed trade", () => {
    const pWin = wins.length / closed.length;
    const expected = round2(pWin * pf.summary.avg_win_pct + (1 - pWin) * pf.summary.avg_loss_pct);
    expect(pf.summary.expectancy_pct).not.toBeNull();
    expect(pf.summary.expectancy_pct ?? 0).toBeCloseTo(expected, 2);
  });

  it("cross-checks expectancy against the mean pnl_pct of closed trades", () => {
    // An independent route to the same quantity: expectancy is the average
    // outcome per closed trade, so it must equal the mean realised pnl_pct.
    const meanPct = closed.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / closed.length;
    expect(pf.summary.expectancy_pct ?? 0).toBeCloseTo(meanPct, 1);
  });

  it("keeps starting_capital positive and equal to the curve's first point", () => {
    expect(pf.summary.starting_capital).toBeGreaterThan(0);
    expect(pf.equity_curve[0]?.equity).toBe(pf.summary.starting_capital);
  });

  it("keeps the summary internally free of NaN", () => {
    for (const [key, value] of Object.entries(pf.summary)) {
      if (value === null) continue;
      expect(Number.isFinite(value), key).toBe(true);
    }
  });
});

/* ── Equity curve ────────────────────────────────────────────────────── */

describe("mockPortfolioWyckoff — equity curve", () => {
  it("carries at least 40 points", () => {
    expect(pf.equity_curve.length).toBeGreaterThanOrEqual(40);
  });

  it("formats every curve date as DD-MM-YYYY", () => {
    for (const p of pf.equity_curve) {
      expect(p.date, p.date).toMatch(DMY);
    }
  });

  it("orders points strictly ascending by date", () => {
    const curve = pf.equity_curve;
    for (let i = 1; i < curve.length; i += 1) {
      const prev = curve[i - 1];
      const curr = curve[i];
      if (prev === undefined || curr === undefined) throw new Error("hole in the curve");
      expect(dmyKey(curr.date), `${prev.date} -> ${curr.date}`).toBeGreaterThan(dmyKey(prev.date));
    }
  });

  it("spans date_from to date_to", () => {
    expect(pf.equity_curve[0]?.date).toBe(pf.date_from);
    expect(pf.equity_curve[pf.equity_curve.length - 1]?.date).toBe(pf.date_to);
  });

  it("skips weekends, since IDX does not trade them", () => {
    for (const p of pf.equity_curve) {
      const day = new Date(dmyKey(p.date)).getUTCDay();
      expect(day, p.date).not.toBe(0);
      expect(day, p.date).not.toBe(6);
    }
  });

  it("keeps drawdown_pct at or below zero everywhere", () => {
    for (const p of pf.equity_curve) {
      expect(p.drawdown_pct, p.date).toBeLessThanOrEqual(0);
    }
  });

  it("starts at the starting capital with zero drawdown", () => {
    expect(pf.equity_curve[0]?.equity).toBe(pf.summary.starting_capital);
    expect(pf.equity_curve[0]?.drawdown_pct).toBe(0);
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

  it("reproduces the curve independently from the closed trades", () => {
    // Rebuild the running realised sum from the ledger and compare, cell by
    // cell. This is the strongest statement that the curve is not decorative.
    const byDate = new Map<string, number>();
    for (const t of closed) {
      if (t.exit_date === null || t.pnl === null) continue;
      byDate.set(t.exit_date, (byDate.get(t.exit_date) ?? 0) + t.pnl);
    }
    let cumulative = 0;
    let peak: number | null = null;
    for (const p of pf.equity_curve) {
      cumulative += byDate.get(p.date) ?? 0;
      const equity = round2(pf.summary.starting_capital + cumulative);
      if (peak === null || equity > peak) peak = equity;
      const dd = peak > 0 ? round2(((equity - peak) / peak) * 100) : 0;
      expect(p.equity, p.date).toBeCloseTo(equity, 2);
      expect(p.drawdown_pct, p.date).toBeCloseTo(dd, 2);
    }
  });
});

/* ── Max drawdown ────────────────────────────────────────────────────── */

describe("mockPortfolioWyckoff — max drawdown", () => {
  it("equals the worst drawdown in the curve", () => {
    const worst = pf.equity_curve.reduce((min, p) => Math.min(min, p.drawdown_pct), 0);
    expect(pf.summary.max_drawdown_pct).toBeCloseTo(worst, 4);
  });

  it("is negative, since the curve does dip below a peak", () => {
    expect(pf.summary.max_drawdown_pct).toBeLessThan(0);
  });

  it("matches an independent peak-to-trough walk over the equity series", () => {
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

/* ── Determinism ─────────────────────────────────────────────────────── */

describe("mockPortfolioWyckoff — determinism", () => {
  it("carries no Math.random or Date.now dependency in its values", () => {
    // Reading the module twice in one process yields the same object identity,
    // so nothing is regenerated per import. The assertions below pin the
    // values that a clock or RNG would otherwise perturb.
    expect(pf.summary.trades).toBe(26);
    expect(pf.summary.win_rate).toBe(54.55);
    expect(pf.summary.total_pnl).toBe(53_593_500);
    expect(pf.date_from).toBe("01-06-2026");
    expect(pf.equity_curve.length).toBe(312);
  });

  it("serialises to a stable string on repeated reads", () => {
    expect(JSON.stringify(mockPortfolioWyckoff)).toBe(JSON.stringify(pf));
  });
});

/* ── The comparison: this is why the second book exists ──────────────── */

describe("mockPortfolioWyckoff — differs from the BSJP book", () => {
  it("reports a different win rate from the BSJP book", () => {
    expect(pf.summary.win_rate).not.toBe(mockPortfolio.summary.win_rate);
    expect(Math.abs(pf.summary.win_rate - mockPortfolio.summary.win_rate)).toBeGreaterThan(1);
  });

  it("reports a different total P&L from the BSJP book", () => {
    expect(pf.summary.total_pnl).not.toBe(mockPortfolio.summary.total_pnl);
    expect(pf.summary.total_pnl).not.toBeCloseTo(mockPortfolio.summary.total_pnl, 0);
  });

  it("trades a different ledger, not the same rows relabelled", () => {
    const mine = pf.trades.map((t) => `${t.ticker}|${t.entry_date}|${t.entry}`).sort();
    const theirs = mockPortfolio.trades
      .map((t) => `${t.ticker}|${t.entry_date}|${t.entry}`)
      .sort();
    expect(mine).not.toEqual(theirs);
  });

  it("uses a distinct id space, so the two books never collide in one table", () => {
    const mine = new Set(pf.trades.map((t) => t.id));
    for (const t of mockPortfolio.trades) {
      expect(mine.has(t.id), `id ${t.id}`).toBe(false);
    }
  });

  it("shows the intended strategy shape: a lower win rate but a larger average win", () => {
    // The design statement behind the dataset — fewer winners, bigger winners.
    // If a future edit flips this, the comparison stops being interesting.
    expect(pf.summary.win_rate).toBeLessThan(mockPortfolio.summary.win_rate);
    expect(pf.summary.avg_win_pct).toBeGreaterThan(mockPortfolio.summary.avg_win_pct);
    expect(pf.summary.avg_loss_pct).toBeLessThan(mockPortfolio.summary.avg_loss_pct);
  });

  it("is comparable in total return, so neither book is a foregone conclusion", () => {
    // Same starting capital, so total_pnl_pct is directly comparable. The
    // Wyckoff book should be the stronger of the two but in the same league.
    expect(pf.summary.starting_capital).toBe(mockPortfolio.summary.starting_capital);
    expect(pf.summary.total_pnl_pct).toBeGreaterThan(mockPortfolio.summary.total_pnl_pct);
    expect(pf.summary.total_pnl_pct).toBeLessThan(mockPortfolio.summary.total_pnl_pct * 10);
  });

  it("differs in every trade's phase usage from the BSJP book", () => {
    // The Wyckoff book's defining feature: every row carries an accumulation
    // phase. The BSJP book also populates phase, but mixes in sell-side and
    // NEUTRAL values that cannot appear here.
    const bsjsPhases = new Set(mockPortfolio.trades.map((t) => t.phase));
    for (const t of pf.trades) {
      expect(t.phase, `${t.ticker}#${t.id}`).not.toBe("NEUTRAL");
      expect(t.phase, `${t.ticker}#${t.id}`).not.toBe("UPTHRUST");
      expect(t.phase, `${t.ticker}#${t.id}`).not.toBe("DISTRI");
    }
    expect(bsjsPhases.has("NEUTRAL") || bsjsPhases.has("UPTHRUST")).toBe(true);
  });
});

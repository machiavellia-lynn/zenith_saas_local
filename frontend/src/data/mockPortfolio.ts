/**
 * Static mock of `GET /api/portfolio` (the BSJP simulation ledger).
 *
 * Field-for-field shape comes from the reference backend:
 *   D:\zenith_saas\algo\algo_portfolio.py  L65-99, L355-400   (READ-ONLY)
 *   D:\zenith_saas\routes\routes_portfolio.py L76-87
 *
 * Mirrored from that file:
 *  - P&L in Rp is `lots × PF_LOT_SIZE × (exit − entry)`, i.e. a lot is 100
 *    shares (L182). Every `pnl` below is computed that way, not typed in.
 *  - `_max_drawdown_pct` (L72-84) walks the equity curve against its running
 *    peak and reports the worst peak-to-trough drop as a negative %; `0.0` when
 *    the curve never falls. The same walk produces `drawdown_pct` per point.
 *  - Lot count is `floor(alloc / (price × lot))`, min 1 (L65-69), off the
 *    reference's `PF_INITIAL_EQUITY = 50_000_000` basis (config.py L84-110).
 *
 * Everything in `summary` is folded from `trades` / `equity_curve` at module
 * load, in the same spirit as `mockFlow.ts`' totals: a hardcoded win rate can
 * drift from the trades it describes, a derived one cannot.
 *
 * `win_rate` is a PERCENTAGE (0–100), matching the reference backend
 * (`algo_portfolio.py` emits `round(wins / closed * 100, 2)`). It is rendered
 * with `formatPct` as-is; scaling it again would show 0.64% instead of 63.64%.
 */

import type {
  EquityPoint,
  PortfolioResponse,
  PortfolioSummary,
  PortfolioTrade,
} from "../types.pages";

/** IDX lot size: 1 lot = 100 shares (config.PF_LOT_SIZE). */
const LOT_SIZE = 100;

/** Capital the simulation starts from, in Rp (config.PF_INITIAL_EQUITY). */
const STARTING_CAPITAL = 50_000_000;

/** Capital deployed per signal, in Rp (config.PF_BSJP_ALLOC). */
const ALLOC_PER_TRADE = 30_000_000;

/** Sessions the curve spans, oldest first. DD-MM-YYYY, weekends skipped. */
const SESSION_DATES: readonly string[] = [
  "02-06-2026", "03-06-2026", "04-06-2026", "05-06-2026", "08-06-2026",
  "09-06-2026", "10-06-2026", "11-06-2026", "12-06-2026", "15-06-2026",
  "16-06-2026", "17-06-2026", "18-06-2026", "19-06-2026", "22-06-2026",
  "23-06-2026", "24-06-2026", "25-06-2026", "26-06-2026", "29-06-2026",
  "30-06-2026", "01-07-2026", "02-07-2026", "03-07-2026", "06-07-2026",
  "07-07-2026", "08-07-2026", "09-07-2026", "10-07-2026", "13-07-2026",
  "14-07-2026", "15-07-2026", "16-07-2026", "17-07-2026", "20-07-2026",
  "21-07-2026", "22-07-2026", "23-07-2026", "24-07-2026", "27-07-2026",
  "28-07-2026", "29-07-2026", "30-07-2026", "31-07-2026", "03-08-2026",
  "04-08-2026", "05-08-2026", "06-08-2026", "07-08-2026", "10-08-2026",
  "11-08-2026", "12-08-2026", "13-08-2026", "14-08-2026", "17-08-2026",
  "18-08-2026", "19-08-2026", "20-08-2026", "21-08-2026", "24-08-2026",
  "25-08-2026", "26-08-2026", "27-08-2026", "28-08-2026", "31-08-2026",
  "01-09-2026", "02-09-2026", "03-09-2026", "04-09-2026", "07-09-2026",
  "08-09-2026", "09-09-2026", "10-09-2026", "11-09-2026", "14-09-2026",
  "15-09-2026", "16-09-2026", "17-09-2026", "18-09-2026", "21-09-2026",
  "22-09-2026", "23-09-2026", "24-09-2026", "25-09-2026", "28-09-2026",
  "29-09-2026", "30-09-2026", "01-10-2026", "02-10-2026",
];

/**
 * One trade's inputs.
 *
 * A CLOSED trade carries both prices and both dates; an OPEN trade carries
 * only its entry, and its mark is `mark` — the price it would exit at if the
 * book were closed today. Open P&L is shown but deliberately excluded from the
 * realised statistics, which is what the backend does.
 */
interface TradeSpec {
  ticker: string;
  setup: string;
  entryDate: string;
  entry: number;
  /** Exit price, or null while the position is still open. */
  exit: number | null;
  exitDate: string | null;
  phase: string;
  /** Mark price for OPEN rows; ignored once `exit` is set. */
  mark: number;
}

/** Whole rupiah. Both endpoints are already tick-aligned in the specs. */
function whole(v: number): number {
  return Math.round(v);
}

/** Round to 2dp, the backend's rounding for every ratio and percentage. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Whole lots affordable for `alloc` at `entry`, min 1 (algo_portfolio.py L65-69). */
function lotsFor(entry: number): number {
  return Math.max(1, Math.floor(ALLOC_PER_TRADE / (entry * LOT_SIZE)));
}

/**
 * The realised book, oldest first, plus the still-open tail.
 *
 * Ordered entry-date ascending so the trade table's default order and the
 * equity curve tell the same story: the curve is the cumulative result of
 * exactly these rows.
 */
const TRADE_SPECS: readonly TradeSpec[] = [
  { ticker: "BBRI", setup: "POWER_BREAK_V21", entryDate: "02-06-2026", entry: 4_215, exit: 4_380, exitDate: "05-06-2026", phase: "SOS", mark: 4_380 },
  { ticker: "ANTM", setup: "SMA5_BREAKOUT_V13", entryDate: "03-06-2026", entry: 1_465, exit: 1_425, exitDate: "08-06-2026", phase: "SPRING", mark: 1_425 },
  { ticker: "TLKM", setup: "POWER_BREAK_V21", entryDate: "05-06-2026", entry: 3_180, exit: 3_245, exitDate: "10-06-2026", phase: "ACCUM", mark: 3_245 },
  { ticker: "BRPT", setup: "POWER_BREAK_V21", entryDate: "09-06-2026", entry: 1_105, exit: 1_245, exitDate: "12-06-2026", phase: "SOS", mark: 1_245 },
  { ticker: "BMRI", setup: "POWER_BREAK_V21", entryDate: "11-06-2026", entry: 5_925, exit: 5_850, exitDate: "16-06-2026", phase: "UPTHRUST", mark: 5_850 },
  { ticker: "BBNI", setup: "SMA5_BREAKOUT_V13", entryDate: "15-06-2026", entry: 4_640, exit: 4_780, exitDate: "18-06-2026", phase: "SOS", mark: 4_780 },
  { ticker: "SMRA", setup: "SMA5_BREAKOUT_V13", entryDate: "17-06-2026", entry: 612, exit: 592, exitDate: "22-06-2026", phase: "DISTRI", mark: 592 },
  { ticker: "ARTO", setup: "SMA5_BREAKOUT_V13", entryDate: "19-06-2026", entry: 2_480, exit: 2_730, exitDate: "25-06-2026", phase: "SOS", mark: 2_730 },
  { ticker: "ASII", setup: "POWER_BREAK_V21", entryDate: "23-06-2026", entry: 4_760, exit: 4_825, exitDate: "26-06-2026", phase: "ACCUM", mark: 4_825 },
  { ticker: "ADHI", setup: "SMA5_BREAKOUT_V13", entryDate: "25-06-2026", entry: 268, exit: 274, exitDate: "30-06-2026", phase: "ABSORB", mark: 274 },
  { ticker: "MTEL", setup: "POWER_BREAK_V21", entryDate: "29-06-2026", entry: 642, exit: 631, exitDate: "02-07-2026", phase: "NEUTRAL", mark: 631 },
  { ticker: "CTRA", setup: "POWER_BREAK_V21", entryDate: "01-07-2026", entry: 1_175, exit: 1_235, exitDate: "06-07-2026", phase: "SOS", mark: 1_235 },
  { ticker: "BBCA", setup: "POWER_BREAK_V21", entryDate: "03-07-2026", entry: 9_725, exit: 9_925, exitDate: "08-07-2026", phase: "SOS", mark: 9_925 },
  { ticker: "ERAA", setup: "POWER_BREAK_V21", entryDate: "07-07-2026", entry: 398, exit: 386, exitDate: "10-07-2026", phase: "UPTHRUST", mark: 386 },
  { ticker: "INCO", setup: "SMA5_BREAKOUT_V13", entryDate: "09-07-2026", entry: 3_410, exit: 3_565, exitDate: "14-07-2026", phase: "ACCUM", mark: 3_565 },
  { ticker: "ELSA", setup: "POWER_BREAK_V21", entryDate: "13-07-2026", entry: 486, exit: 512, exitDate: "16-07-2026", phase: "SOS", mark: 512 },
  { ticker: "PGAS", setup: "SMA5_BREAKOUT_V13", entryDate: "15-07-2026", entry: 1_635, exit: 1_590, exitDate: "20-07-2026", phase: "DISTRI", mark: 1_590 },
  { ticker: "TOWR", setup: "SMA5_BREAKOUT_V13", entryDate: "21-07-2026", entry: 2_340, exit: 2_415, exitDate: "24-07-2026", phase: "ACCUM", mark: 2_415 },
  { ticker: "MDKA", setup: "POWER_BREAK_V21", entryDate: "23-07-2026", entry: 2_180, exit: 2_090, exitDate: "28-07-2026", phase: "DISTRI", mark: 2_090 },
  { ticker: "JSMR", setup: "SMA5_BREAKOUT_V13", entryDate: "27-07-2026", entry: 4_640, exit: 4_830, exitDate: "31-07-2026", phase: "SOS", mark: 4_830 },
  { ticker: "BUKA", setup: "POWER_BREAK_V21", entryDate: "29-07-2026", entry: 186, exit: 178, exitDate: "03-08-2026", phase: "UPTHRUST", mark: 178 },
  { ticker: "UNTR", setup: "POWER_BREAK_V21", entryDate: "04-08-2026", entry: 25_875, exit: 26_750, exitDate: "10-08-2026", phase: "SOS", mark: 26_750 },
  // Open positions: entered, marked, not yet exited.
  { ticker: "BBRI", setup: "SMA5_BREAKOUT_V13", entryDate: "18-08-2026", entry: 4_390, exit: null, exitDate: null, phase: "SOS", mark: 4_465 },
  { ticker: "BRIS", setup: "SMA5_BREAKOUT_V13", entryDate: "25-08-2026", entry: 2_845, exit: null, exitDate: null, phase: "SOS", mark: 2_925 },
];

/** Fold the raw specs into `PortfolioTrade` rows, computing P&L in Rp. */
function buildTrades(specs: readonly TradeSpec[]): PortfolioTrade[] {
  return specs.map((s, i) => {
    const lots = lotsFor(s.entry);
    // An OPEN row is marked at `mark`; a CLOSED row at its realised exit. The
    // `??` keeps the two branches explicit without a non-null assertion.
    const exit = s.exit ?? s.mark;
    const pnlRp = lots * LOT_SIZE * (exit - s.entry);
    const pnlPct = r2(((exit - s.entry) / s.entry) * 100);

    return {
      id: 4_100 + i * 3,
      ticker: s.ticker,
      setup: s.setup,
      entry_date: s.entryDate,
      exit_date: s.exit === null ? null : s.exitDate,
      entry: whole(s.entry),
      exit: whole(exit),
      lots,
      pnl: Math.round(pnlRp),
      pnl_pct: pnlPct,
      status: s.exit === null ? "OPEN" : "CLOSED",
      phase: s.phase,
    };
  });
}

const trades = buildTrades(TRADE_SPECS);
const closed = trades.filter((t) => t.status === "CLOSED");

/**
 * Cumulative realised P&L folded onto the session axis.
 *
 * A trade's realised Rupiah lands on the session it *exited*, so the curve is
 * the running sum of exactly the closed rows above and the last point is
 * `starting_capital + total_pnl` by construction — the identity the tests
 * check. Open positions carry unrealised P&L on their own rows but are kept
 * off the curve, the same split the backend makes between the ledger and the
 * realised statistics.
 */
function buildEquityCurve(): EquityPoint[] {
  const realisedByDate = new Map<string, number>();
  for (const t of closed) {
    if (t.exit_date === null || t.pnl === null) continue;
    realisedByDate.set(t.exit_date, (realisedByDate.get(t.exit_date) ?? 0) + t.pnl);
  }

  const curve: EquityPoint[] = [];
  let cumulative = 0;
  let peak: number | null = null;

  for (const date of SESSION_DATES) {
    cumulative += realisedByDate.get(date) ?? 0;

    const equity = r2(STARTING_CAPITAL + cumulative);

    if (peak === null || equity > peak) peak = equity;
    const drawdown = peak > 0 ? r2(((equity - peak) / peak) * 100) : 0;

    curve.push({ date, equity, drawdown_pct: drawdown });
  }

  return curve;
}

/**
 * Fold the summary from the rows it describes (algo_portfolio.py L355-400).
 *
 * `win_rate` is a percentage over closed trades only — open positions have
 * no outcome yet and would only dilute it. Wins are strictly `pnl > 0`; a flat
 * trade counts as a loss, matching the backend's `> 0` vs `<= 0` boundary.
 */
function summarise(
  curve: readonly EquityPoint[],
  closedTrades: readonly PortfolioTrade[],
  allTrades: readonly PortfolioTrade[],
): PortfolioSummary {
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closedTrades.filter((t) => (t.pnl ?? 0) <= 0);
  const n = closedTrades.length;

  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const equity = curve[curve.length - 1]?.equity ?? STARTING_CAPITAL;

  const grossWin = wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0));

  const avgWinPct = wins.length === 0
    ? 0
    : r2(wins.reduce((sum, t) => sum + (t.pnl_pct ?? 0), 0) / wins.length);
  const avgLossPct = losses.length === 0
    ? 0
    : r2(losses.reduce((sum, t) => sum + (t.pnl_pct ?? 0), 0) / losses.length);

  const worstDrawdown = curve.reduce(
    (worst, p) => (p.drawdown_pct < worst ? p.drawdown_pct : worst),
    0,
  );

  // Percentage (0–100), matching the reference backend — see the note on
  // PortfolioSummary.win_rate. Rendering this with formatPct must NOT scale it
  // again; the previous `r2(winRate * 100) / 100` double-converted and would
  // have displayed 0.64% instead of 63.64%.
  const winRatePct = n === 0 ? 0 : (wins.length / n) * 100;

  return {
    starting_capital: STARTING_CAPITAL,
    equity,
    total_pnl: Math.round(totalPnl),
    total_pnl_pct: r2((totalPnl / STARTING_CAPITAL) * 100),
    win_rate: r2(winRatePct),
    // `trades` counts the ledger the UI lists — open positions included —
    // while wins/losses are realised-only, exactly as the backend splits them.
    trades: allTrades.length,
    wins: wins.length,
    losses: losses.length,
    max_drawdown_pct: r2(worstDrawdown),
    avg_win_pct: avgWinPct,
    avg_loss_pct: avgLossPct,
    profit_factor: grossLoss > 0 ? r2(grossWin / grossLoss) : null,
    expectancy_pct:
      n === 0 ? null : r2((wins.length / n) * avgWinPct + (1 - wins.length / n) * avgLossPct),
  };
}

const equityCurve = buildEquityCurve();

/** Mock forecast of the BSJP book, shaped like `GET /api/portfolio`. */
export const mockPortfolio: PortfolioResponse = {
  summary: summarise(equityCurve, closed, trades),
  equity_curve: equityCurve,
  trades,
  date_from: SESSION_DATES[0] ?? "",
  date_to: SESSION_DATES[SESSION_DATES.length - 1] ?? "",
};

/**
 * Static mock of a SECOND portfolio book — the Wyckoff simulation ledger.
 *
 * This is the sibling of `mockPortfolio.ts` (the BSJP book) and exists so the
 * Portfolio page can put two strategies' equity curves side by side. It is
 * shaped like `GET /api/portfolio` exactly as the BSJP book is, from
 * `PortfolioResponse` in `types.pages.ts`, and it keeps that file's
 * consistency discipline verbatim:
 *
 *  - P&L in Rp is `lots × 100 × (exit − entry)`; a lot is 100 shares (IDX).
 *    Every `pnl` below is derived by that formula, never typed in.
 *  - `equity_curve` is the running sum of the *closed* rows' realised Rupiah,
 *    so its last point is `starting_capital + total_pnl` by construction.
 *  - `summary` is folded from `trades` / `equity_curve` at module load. A
 *    hardcoded win rate drifts from the trades it describes; a derived one
 *    cannot drift.
 *  - `win_rate` is a PERCENTAGE (0–100), per the `PortfolioSummary.win_rate`
 *    doc comment. `PortfolioPage` renders it through `formatPct` without
 *    rescaling, so a 0–1 fraction here would display as 0.45% instead of 45%.
 *
 * Where the two books differ
 * --------------------------
 * The BSJP book wins ~63.6% of the time on small, frequent moves. This one is
 * a Wyckoff book: it enters only on accumulation (SPRING / ABSORB / SOS /
 * ACCUM) and exits on distribution (UPTHRUST / DISTRI) or a target/stop. The
 * consequence is modelled here as written: FEWER winners with LARGER average
 * wins, because the exit waits for the markup move to complete rather than
 * taking a quick tick. That lands the total return close to the BSJP book —
 * which is the point of showing two curves. A second book that simply lost on
 * every axis would not be worth comparing.
 *
 * Determinism
 * -----------
 * Both the price walk and the P&L multipliers come from a seeded LCG, the same
 * Numerical-Recipes generator `mockCandles.ts` uses. No `Math.random`, no
 * `Date.now()`: the ledger renders identically on every machine and build.
 *
 * Realism is preserved structurally, not by luck:
 *  - `exit` is derived FROM the multiplier, so `pnl` and `pnl_pct` can never
 *    contradict at all; there is no separate exit literal to fall out of sync.
 *  - Multipliers are bounded to a plausible band per strategy, so no trade
 *    shows a −60% or +400% day.
 *  - Exits land on the session grid, so every exit date is a trading day.
 */

import type {
  EquityPoint,
  PortfolioResponse,
  PortfolioSummary,
  PortfolioTrade,
} from "../types.pages";
import type { Phase } from "../types";
import { BUY_PHASES, PHASES, SELL_PHASES } from "../types";

/** IDX lot size: 1 lot = 100 shares. */
const LOT_SIZE = 100;

/** Capital this book starts from, in Rp — same basis as the BSJP book. */
const STARTING_CAPITAL = 50_000_000;

/** Capital deployed per signal, in Rp. */
const ALLOC_PER_TRADE = 30_000_000;

/** Human label for this book, for a comparing UI or a chart legend. */
export const WYCKOFF_STRATEGY_LABEL = "Wyckoff";

/**
 * The closed set of setup labels a Wyckoff book can emit.
 *
 * Each names the structure the entry was taken on, which is why these are not
 * the BSJP setup codes: a Wyckoff trade is defined by *where in the cycle* it
 * was entered, and the label has to say which one.
 */
export const WYCKOFF_SETUPS = [
  "SPRING_ENTRY",
  "SOS_BREAKOUT",
  "ABSORB_ACCUM",
  "ACCUM_RANGE",
] as const;

/** One of the setup labels this book carries. */
export type WyckoffSetup = (typeof WYCKOFF_SETUPS)[number];

/** The phases an entry may be taken on: accumulation only, never neutral. */
export const WYCKOFF_ENTRY_PHASES: readonly Phase[] = BUY_PHASES;

/** The phases that force an exit: distribution only. */
export const WYCKOFF_EXIT_PHASES: readonly Phase[] = SELL_PHASES;

/**
 * Seed of the LCG. Distinct from every other mock's seed so this book's stream
 * is its own — two books drawing from one stream would correlate their P&L,
 * and a correlated comparison is not a comparison.
 */
const BASE_SEED = 0x5eed_a17c;

/**
 * Sessions this book spans, oldest first, one entry per IDX trading day
 * (Monday–Friday). Generated rather than listed: 300-odd literals are easy to
 * mistype, and a single transposed day silently breaks the ascending-date
 * invariant the chart relies on.
 *
 * The window has to be at LEAST as long as the book it carries. The closed
 * trades hold for ~270 calendar days in total and the gaps add ~30 more, so a
 * shorter axis would push the tail onto the final session via `sessionAfter`'s
 * clamp and collapse a dozen exits onto one date. The OPEN tail needs room
 * after the last exit for the same reason — four open positions sharing one
 * entry date reads as a data bug, not a book. 312 sessions ≈ 14 months clears
 * the ~300 the book needs; the tests assert the entry- and exit-date spreads
 * so this cannot regress silently.
 */
const CURVE_START = "01-06-2026";
const CURVE_SESSIONS = 312;

/** A 32-bit LCG (Numerical Recipes constants), as in `mockCandles.ts`. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Uniform draw in [lo, hi) from an LCG stream. */
function between(rand: () => number, lo: number, hi: number): number {
  return lo + rand() * (hi - lo);
}

/**
 * In-place Fisher–Yates shuffle driven by `rand`.
 *
 * Used to deal the win/loss deck below. Returns a new array rather than
 * mutating the caller's, so the constant it is built from stays intact.
 */
function shuffled<T>(rand: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * The win/loss outcome deck for the closed trades.
 *
 * An LCG stream is not a fair coin, and over only 22 draws a fair-looking
 * `rand() < 0.5` test is at the mercy of the seed: an earlier revision of this
 * file drew 19 wins out of 22 and reported an 86% win rate, which is neither
 * the strategy this book is meant to model nor believable for one. Dealing
 * from an exactly-balanced deck removes that dependence while leaving the
 * per-trade ordering random — the shuffles are seeded like everything else.
 *
 * 12 wins / 10 losses = 54.55%, the "fewer winners, larger winners" shape.
 */
function outcomeDeck(): boolean[] {
  const rand = lcg(BASE_SEED ^ 0x9e37_79b9);
  return shuffled(rand, [
    ...new Array<boolean>(WIN_COUNT).fill(true),
    ...new Array<boolean>(LOSS_COUNT).fill(false),
  ]);
}

/** Pick one element of a non-empty list; throws rather than return undefined. */
function pick<T>(rand: () => number, items: readonly [T, ...T[]]): T {
  const i = Math.min(items.length - 1, Math.floor(rand() * items.length));
  const item = items[i];
  if (item === undefined) throw new Error("pick: empty option list");
  return item;
}

/** Round to 2dp, the backend's rounding for every ratio and percentage. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Whole lots affordable for `alloc` at `entry`, min 1. */
function lotsFor(entry: number): number {
  return Math.max(1, Math.floor(ALLOC_PER_TRADE / (entry * LOT_SIZE)));
}

/**
 * Snap a price to the IDX tick grid, the same bands `algo_bsjp._to_tick` uses.
 *
 * Keeping prices tick-aligned is what makes them plausible: no IDX stock ever
 * quoted Rp4,217.
 */
function toTick(price: number): number {
  const tick = price < 200 ? 1 : price < 500 ? 2 : price < 5_000 ? 5 : 25;
  return Math.max(tick, Math.round(price / tick) * tick);
}

/* ── Date axis ───────────────────────────────────────────────────────── */

/** Parse DD-MM-YYYY into a UTC epoch, or NaN when the string is malformed. */
function dmyKey(dmy: string): number {
  const [d = "0", m = "0", y = "0"] = dmy.split("-");
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

/** Format a UTC epoch back to DD-MM-YYYY. */
function toDmy(epoch: number): string {
  const d = new Date(epoch);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${dd}-${mm}-${yy}`;
}

/**
 * `count` consecutive weekdays starting at `start`, oldest first.
 *
 * Weekends are skipped because IDX does not trade them. Exchange holidays are
 * not modelled — fine for a mock, and the tests only assert ascending dates.
 */
function sessionDates(start: string, count: number): string[] {
  const cursor = new Date(dmyKey(start));
  const dates: string[] = [];

  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(toDmy(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

const SESSION_DATES: readonly string[] = sessionDates(CURVE_START, CURVE_SESSIONS);

/**
 * The `offset`-th session in `SESSION_DATES` at or after `fromIndex`.
 *
 * Walks the grid rather than adding calendar days, so a trade's holding period
 * never lands on a weekend and an exit date is always a real session.
 */
function sessionAfter(fromIndex: number, offset: number): number {
  return Math.min(SESSION_DATES.length - 1, fromIndex + offset);
}

/* ── Trade generation ────────────────────────────────────────────────── */

/** One generated trade before it is folded into a `PortfolioTrade` row. */
interface BookTrade {
  ticker: string;
  setup: WyckoffSetup;
  phase: Phase;
  entryDate: string;
  entry: number;
  /** Exit price for a closed row; null while the position is still open. */
  exit: number | null;
  exitDate: string | null;
  /**
   * The realised multiplier applied to `entry` to get `exit`. Kept only so the
   * generator's own output can be asserted in tests; never shipped.
   */
  realisedMultiple: number;
}

/**
 * How the book's two exit outcomes are shaped.
 *
 * Wyckoff exits on distribution or on a target/stop, and it holds through the
 * markup: fewer trades reach the win column, but the ones that do travel much
 * further. The bands below encode exactly that, and are the ONLY place the
 * book's risk profile is stated — every exit price is derived from them.
 */
interface ExitProfile {
  /** Winner multiple band, on top of `entry`. */
  winBand: readonly [number, number];
  /** Loser multiple band — the stop, tight and disciplined. */
  lossBand: readonly [number, number];
  /** Sessions held. The winner is the slow one: it waits for the markup. */
  winHold: readonly [number, number];
  lossHold: readonly [number, number];
}

/**
 * Average win ≈ +18%, average loss ≈ −7%, and the winner is held 2–3× longer.
 *
 * The BSJP book wins 63.6% but takes small, quick moves. This one wins 54.6%
 * on moves that run — a different shape pointing at a similar total return,
 * which is what makes the side-by-side chart worth looking at.
 */
const EXIT_PROFILE: ExitProfile = {
  winBand: [1.08, 1.32],
  lossBand: [0.9, 0.965],
  winHold: [8, 20],
  lossHold: [2, 7],
};

/**
 * The ticker universe, with a per-name anchor price in whole rupiah.
 *
 * Deliberately spans the price bands the terminal table sees — a Rp168 coal
 * name up to a Rp26,000 heavy equipment name — so the lot sizing and the
 * currency formatter both get exercised.
 */
const TICKERS: readonly { ticker: string; anchor: number }[] = [
  { ticker: "BBRI", anchor: 4_310 },
  { ticker: "BMRI", anchor: 5_875 },
  { ticker: "TLKM", anchor: 3_205 },
  { ticker: "ANTM", anchor: 1_505 },
  { ticker: "ADRO", anchor: 2_460 },
  { ticker: "INCO", anchor: 3_530 },
  { ticker: "PTBA", anchor: 2_740 },
  { ticker: "ASII", anchor: 4_810 },
  { ticker: "UNTR", anchor: 26_150 },
  { ticker: "MDKA", anchor: 2_205 },
  { ticker: "GOTO", anchor: 71 },
  { ticker: "ISAT", anchor: 9_640 },
  { ticker: "PGAS", anchor: 1_688 },
  { ticker: "CTRA", anchor: 1_194 },
  { ticker: "BUMI", anchor: 168 },
];

/**
 * Setups and the phase each is taken on.
 *
 * The mapping is the domain statement this book rests on: a SPRING entry is
 * only ever seen during a SPRING, a breakout only during SOS, and so on. There
 * is no NEUTRAL entry — that is what "the Wyckoff book only enters on
 * accumulation" means, and it is enforced by the type plus a test.
 */
interface SetupPhase {
  setup: WyckoffSetup;
  phase: Phase;
}

const SETUP_PHASE: readonly [SetupPhase, ...SetupPhase[]] = [
  { setup: "SPRING_ENTRY", phase: "SPRING" },
  { setup: "SOS_BREAKOUT", phase: "SOS" },
  { setup: "ABSORB_ACCUM", phase: "ABSORB" },
  { setup: "ACCUM_RANGE", phase: "ACCUM" },
];

/**
 * Winners and losers in the closed book.
 *
 * Fixed rather than probabilistic — see `outcomeDeck()`. 12/22 = 54.55%.
 */
const WIN_COUNT = 12;
const LOSS_COUNT = 10;

/** How many positions the book takes over the window, and how many stay open. */
const CLOSED_COUNT = 22;
const OPEN_COUNT = 4;

/**
 * Sessions to leave open after a closed trade before the next entry.
 *
 * Tuned to `hold` above so the 26 entries fit inside `CURVE_SESSIONS` with
 * room to spare. If they did not fit, `sessionAfter` would clamp the overflow
 * onto the final session and a dozen trades would share one exit date — a
 * ledger the equity curve would faithfully but misleadingly draw as a single
 * vertical step. The tests assert the spread, not just the ordering, so that
 * failure mode cannot come back silently.
 */
const GAP_AFTER_CLOSED: readonly [number, number] = [1, 3];
const GAP_AFTER_OPEN: readonly [number, number] = [2, 4];

/**
 * Build the ledger oldest-first.
 *
 * Entries are spaced a few sessions apart so positions overlap the way a real
 * book's do. The OPEN tail sits after the last closed exit, which is what
 * guarantees its unrealised P&L can never leak into the realised curve.
 */
function generateTrades(): BookTrade[] {
  const rand = lcg(BASE_SEED);
  const deck = outcomeDeck();
  const trades: BookTrade[] = [];

  let entryIndex = 0;
  let closedSeen = 0;

  for (let i = 0; i < CLOSED_COUNT + OPEN_COUNT; i += 1) {
    const isOpen = i >= CLOSED_COUNT;

    const name = TICKERS[i % TICKERS.length];
    if (name === undefined) throw new Error("generateTrades: empty ticker list");

    // Entry sits a few percent off the anchor, drifting with the walk.
    const entry = toTick(name.anchor * between(rand, 0.94, 1.06));

    const { setup, phase } = pick(rand, SETUP_PHASE);
    const entryDate = SESSION_DATES[entryIndex] ?? CURVE_START;

    if (isOpen) {
      // OPEN: no exit price, no exit date, and no realised P&L. The curve
      // ignores it, exactly as the realised statistics do.
      trades.push({
        ticker: name.ticker,
        setup,
        phase,
        entryDate,
        entry,
        exit: null,
        exitDate: null,
        realisedMultiple: 1,
      });
      entryIndex = sessionAfter(entryIndex, Math.round(between(rand, GAP_AFTER_OPEN[0], GAP_AFTER_OPEN[1])));
      continue;
    }

    // The outcome comes off the shuffled deck, so the book's win rate is the
    // one the profile states rather than whatever the LCG happened to draw.
    const isWin = deck[closedSeen] ?? false;
    closedSeen += 1;

    const multiple = isWin
      ? between(rand, EXIT_PROFILE.winBand[0], EXIT_PROFILE.winBand[1])
      : between(rand, EXIT_PROFILE.lossBand[0], EXIT_PROFILE.lossBand[1]);
    const hold = Math.max(
      1,
      Math.round(
        isWin
          ? between(rand, EXIT_PROFILE.winHold[0], EXIT_PROFILE.winHold[1])
          : between(rand, EXIT_PROFILE.lossHold[0], EXIT_PROFILE.lossHold[1]),
      ),
    );

    const exitIdx = sessionAfter(entryIndex, hold);
    // `exit` is DERIVED from the multiplier, so P&L can never disagree with it.
    // The tick snap is the only quantisation; it is what a real fill gives.
    const exit = toTick(entry * multiple);
    const exitDate = SESSION_DATES[exitIdx] ?? entryDate;

    trades.push({
      ticker: name.ticker,
      setup,
      phase,
      entryDate,
      entry,
      exit,
      exitDate,
      realisedMultiple: exit / entry,
    });

    // Leave a couple of empty sessions between entries so positions overlap
    // naturally but the book is never flat for long.
    entryIndex = sessionAfter(
      exitIdx,
      Math.round(between(rand, GAP_AFTER_CLOSED[0], GAP_AFTER_CLOSED[1])),
    );
  }

  return trades;
}

/**
 * The generated ledger, before P&L is folded on.
 *
 * Guarded rather than trusted: if a future edit makes the book outgrow
 * `SESSION_DATES`, `sessionAfter` would clamp every surplus entry onto the
 * final session and a dozen trades would share one date. That produces a
 * *structurally valid* ledger — dates still ascend, P&L still reconciles — so
 * nothing downstream would complain, and the equity curve would draw a
 * plausible-looking vertical step. Failing here instead turns a silent data
 * corruption into an obvious one.
 */
const BOOK_TRADES: readonly BookTrade[] = (() => {
  const book = generateTrades();
  const dates = book.flatMap((t) => (t.exitDate === null ? [t.entryDate] : [t.entryDate, t.exitDate]));
  const distinct = new Set(dates).size;
  if (distinct !== dates.length) {
    throw new Error(
      `mockPortfolioWyckoff: book overran its ${SESSION_DATES.length}-session curve ` +
        `(${dates.length - distinct} date collisions across ${book.length} trades). ` +
        `Raise CURVE_SESSIONS or shorten the holds.`,
    );
  }
  return book;
})();

/** Fold the book into `PortfolioTrade` rows, computing P&L in Rp. */
function buildTrades(book: readonly BookTrade[]): PortfolioTrade[] {
  return book.map((b, i) => {
    const lots = lotsFor(b.entry);
    // An OPEN row carries no exit price — same null the backend emits for a
    // position still on the book. `pnl` stays null for it: unrealised P&L has
    // no business in a realised ledger.
    const exit = b.exit;
    const pnl = exit === null ? null : Math.round(lots * LOT_SIZE * (exit - b.entry));
    const pnlPct = exit === null ? null : r2(((exit - b.entry) / b.entry) * 100);

    return {
      id: 8_200 + i * 3,
      ticker: b.ticker,
      setup: b.setup,
      entry_date: b.entryDate,
      exit_date: b.exitDate,
      entry: b.entry,
      exit,
      lots,
      pnl,
      pnl_pct: pnlPct,
      status: exit === null ? "OPEN" : "CLOSED",
      // Never null: this is the Wyckoff book's whole differentiator, and
      // `phase` is typed `Phase` (not `Phase | null`) upstream of the row.
      phase: b.phase,
    };
  });
}

const trades = buildTrades(BOOK_TRADES);
const closed = trades.filter((t) => t.status === "CLOSED");

/**
 * Cumulative realised P&L folded onto the session axis.
 *
 * A trade's Rupiah lands on the session it *exited*, so the curve is the
 * running sum of exactly the closed rows and the last point is
 * `starting_capital + total_pnl` by construction. Open positions carry
 * unrealised P&L on their own rows but are kept off the curve — the same
 * ledger/realised split the BSJP book makes.
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
 * Fold the summary from the rows it describes.
 *
 * `win_rate` is a percentage over closed trades only — open positions have no
 * outcome yet and would only dilute it. Wins are strictly `pnl > 0`; a flat
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

  const avgWinPct =
    wins.length === 0
      ? 0
      : r2(wins.reduce((sum, t) => sum + (t.pnl_pct ?? 0), 0) / wins.length);
  const avgLossPct =
    losses.length === 0
      ? 0
      : r2(losses.reduce((sum, t) => sum + (t.pnl_pct ?? 0), 0) / losses.length);

  const worstDrawdown = curve.reduce(
    (worst, p) => (p.drawdown_pct < worst ? p.drawdown_pct : worst),
    0,
  );

  // Percentage (0–100) — see the note on PortfolioSummary.win_rate. Multiplying
  // by 100 again downstream would show 0.55% for 55%.
  const winRatePct = n === 0 ? 0 : (wins.length / n) * 100;

  return {
    starting_capital: STARTING_CAPITAL,
    equity,
    total_pnl: Math.round(totalPnl),
    total_pnl_pct: r2((totalPnl / STARTING_CAPITAL) * 100),
    win_rate: r2(winRatePct),
    // `trades` counts the ledger the UI lists, OPEN rows included, while
    // wins/losses are realised-only.
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

/** Session the curve starts on; the book's `date_from`. */
const DATE_FROM = SESSION_DATES[0] ?? CURVE_START;

/** Session the curve ends on; the book's `date_to`. */
const DATE_TO = SESSION_DATES[SESSION_DATES.length - 1] ?? CURVE_START;

const equityCurve = buildEquityCurve();

/** Mock ledger for the Wyckoff book, shaped like `GET /api/portfolio`. */
export const mockPortfolioWyckoff: PortfolioResponse = {
  summary: summarise(equityCurve, closed, trades),
  equity_curve: equityCurve,
  trades,
  date_from: DATE_FROM,
  date_to: DATE_TO,
};

/**
 * The distinct phases this book's rows actually carry, for a UI legend or a
 * quick audit.
 *
 * `phase` is `Phase | null` on `PortfolioTrade` because the interface is shared
 * with books that can leave it unset; this book never does, so a null here
 * would be a generator bug worth surfacing as NEUTRAL rather than crashing a
 * render. `WYCKOFF_PHASE_SET` is the full closed vocabulary to validate against.
 */
export const WYCKOFF_BOOK_PHASES: readonly Phase[] = [
  ...new Set(
    mockPortfolioWyckoff.trades.map((t): Phase => (isPhase(t.phase) ? t.phase : "NEUTRAL")),
  ),
];

/** Every phase the domain allows — the closed set, re-exported for validation. */
export const WYCKOFF_PHASE_SET: readonly Phase[] = PHASES;

/** Narrow a raw row value to the closed phase vocabulary. */
function isPhase(value: string | null): value is Phase {
  return value !== null && (PHASES as readonly string[]).includes(value);
}

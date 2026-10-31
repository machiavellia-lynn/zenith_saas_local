import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioResponse, PortfolioTrade } from "../types.pages";
import {
  fetchPortfolio as defaultFetchPortfolioBSJP,
  fetchPortfolioWyckoff as defaultFetchPortfolioWyckoff,
} from "../data/pages";
import { MultiLineChart } from "../components/MultiLineChart";
import { DatePicker, type DateRange } from "../components/DatePicker";
import { displayToIso } from "../lib/date";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import {
  EM_DASH,
  directionClass,
  formatInt,
  formatPct,
  formatPrice,
  formatRatio,
} from "../lib/format";

type Status = "loading" | "ready" | "error";
type TradeFilter = "ALL" | "OPEN" | "CLOSED";

/** The two simulated books the page compares. */
export type StrategyKey = "BSJP" | "WYCKOFF";

interface StrategyDef {
  key: StrategyKey;
  label: string;
  blurb: string;
}

const STRATEGIES: readonly StrategyDef[] = [
  { key: "BSJP", label: "BSJP", blurb: "Breakout · sideways · trending · pullback" },
  { key: "WYCKOFF", label: "WYCKOFF", blurb: "Spring · absorb · sign of strength" },
] as const;

const FILTERS: readonly { key: TradeFilter; label: string }[] = [
  { key: "ALL", label: "ALL" },
  { key: "OPEN", label: "OPEN" },
  { key: "CLOSED", label: "CLOSED" },
];

/* ── P&L is rupees, like the prices it is derived from ───────────────────── */

/** Split into thousands so a six-figure rupiah P&L stays scannable. */
function groupDigits(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Signed rupiah. A closed trade that goes nowhere is `0`, not `+0`; a null P&L
 * is the em dash. This is deliberately not formatInt — a P&L's "+" carries the
 * same information as its colour, which matters in greyscale.
 */
function formatPnl(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${groupDigits(Math.abs(rounded))}`;
}

/* ── Win-rate bar ────────────────────────────────────────────────────────── */
/*
 * The win/loss bar and its win-rate caption were removed at the owner's
 * request (revision 3b). WIN RATE and the W/L counts still appear in the
 * summary strip and the strategy tiles, so no figure was lost — only the bar.
 */

export interface PortfolioPageProps {
  /** Injectable data access, so states can be exercised without a network. */
  fetchPortfolioBSJP?: typeof defaultFetchPortfolioBSJP;
  fetchPortfolioWyckoff?: typeof defaultFetchPortfolioWyckoff;
}

/**
 * Portfolio simulation: capital growth, the trades behind it, and the
 * win/loss split.
 *
 * The summary comes from the payload's own `summary` rather than being
 * recomputed from `trades` — the reference app computes win rate and profit
 * factor over its whole simulation, and a table of the displayed slice would
 * quietly disagree with it.
 */
export default function PortfolioPage({
  fetchPortfolioBSJP = defaultFetchPortfolioBSJP,
  fetchPortfolioWyckoff = defaultFetchPortfolioWyckoff,
}: PortfolioPageProps = {}) {
  const [status, setStatus] = useState<Status>("loading");
  const [books, setBooks] = useState<Partial<Record<StrategyKey, PortfolioResponse>>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TradeFilter>("ALL");
  const [strategy, setStrategy] = useState<StrategyKey>("BSJP");
  /** The simulated window. Seeded once the payload reports its own dates. */
  const [range, setRange] = useState<DateRange | null>(null);

  const loadId = useRef(0);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setStatus("loading");
    setError(null);
    setBooks({});

    const [bsjp, wyckoff] = await Promise.all([
      fetchPortfolioBSJP(),
      fetchPortfolioWyckoff(),
    ]);
    if (id !== loadId.current) return; // a newer request won

    // The BSJP book is the primary: if it fails there is nothing to show.
    if (bsjp.status === "error" || bsjp.data === null) {
      setStatus("error");
      setError(bsjp.error ?? "Unknown error");
      return;
    }

    setBooks({
      BSJP: bsjp.data,
      // A missing Wyckoff book degrades to a single-curve view rather than
      // failing the whole page.
      ...(wyckoff.status === "ready" && wyckoff.data !== null
        ? { WYCKOFF: wyckoff.data }
        : {}),
    });
    setStatus("ready");
  }, [fetchPortfolioBSJP, fetchPortfolioWyckoff]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = books[strategy] ?? books.BSJP ?? null;
  const trades = useMemo(() => data?.trades ?? [], [data]);

  // Seed the picker from the payload's own window, once.
  useEffect(() => {
    if (range !== null || data === null) return;
    const from = displayToIso(data.date_from);
    const to = displayToIso(data.date_to);
    if (from !== null && to !== null) setRange({ from, to });
  }, [data, range]);

  /**
   * Trades within the picked window, by entry date. Open positions have no exit
   * date, so entry is the only date every row has.
   *
   * Entry dates are DD-MM-YYYY while the picker works in ISO, so both sides are
   * normalised before comparing.
   */
  const inWindow = useMemo(() => {
    if (range === null) return trades;
    return trades.filter((t) => {
      const entryIso = displayToIso(t.entry_date);
      if (entryIso === null) return true;
      return entryIso >= range.from && entryIso <= range.to;
    });
  }, [trades, range]);

  const filtered = useMemo(
    () =>
      filter === "ALL"
        ? inWindow
        : inWindow.filter((t) => (filter === "OPEN" ? t.status === "OPEN" : t.status === "CLOSED")),
    [inWindow, filter],
  );

  const hasColumns = data !== null;
  const noFiltersMatch = trades.length > 0 && filtered.length === 0;

  /** Curves for the side-by-side comparison, in a stable order. */
  const comparison = useMemo(
    () =>
      STRATEGIES.map((s) => ({
        def: s,
        book: books[s.key] ?? null,
      })).filter((c): c is { def: StrategyDef; book: PortfolioResponse } => c.book !== null),
    [books],
  );

  return (
    <section className="portfolio-page" aria-label="Portfolio simulation">
      {status === "loading" && <LoadingState />}

      {status === "error" && error !== null && (
        <ErrorState message={error} onRetry={() => void load()} />
      )}

      {status === "ready" && data === null && (
        <ErrorState message="No portfolio data." onRetry={() => void load()} />
      )}

      {status === "ready" && data !== null && (
        <div className="portfolio-body">
          <div className="page-toolbar">
            {range !== null && (
              <DatePicker value={range} onChange={setRange} label="Simulation window" />
            )}
            <span className="page-toolbar-spacer" />
            <span className="page-toolbar-note">
              {formatInt(inWindow.length)} of {formatInt(trades.length)} trades in window
            </span>
          </div>

          <div className="stat-strip" role="region" aria-label="Portfolio summary">
            <PortfolioStat
              label="EQUITY"
              value={formatInt(data.summary.equity)}
              sub={`from ${formatInt(data.summary.starting_capital)}`}
            />
            <PortfolioStat
              label="TOTAL P&L"
              value={formatPnl(data.summary.total_pnl)}
              sub={formatPct(data.summary.total_pnl_pct)}
              tone={directionClass(data.summary.total_pnl)}
            />
            <PortfolioStat
              label="WIN RATE"
              value={formatPct(data.summary.win_rate)}
              sub={`${formatInt(data.summary.wins)} W / ${formatInt(data.summary.losses)} L`}
              tone={directionClass(data.summary.win_rate)}
            />
            <PortfolioStat
              label="TRADES"
              value={formatInt(data.summary.trades)}
              sub="closed + open"
            />
            <PortfolioStat
              label="MAX DD"
              value={formatPct(-data.summary.max_drawdown_pct)}
              sub="peak to trough"
              tone="val-down"
            />
            <PortfolioStat
              label="PROFIT FACTOR"
              value={formatRatio(data.summary.profit_factor)}
              sub="gross win / gross loss"
            />
          </div>

          <section className="portfolio-section" aria-label="Equity curve comparison">
            <h2 className="portfolio-section-title">
              EQUITY CURVE · WYCKOFF vs BSJP
              <span className="portfolio-section-sub">
                {data.date_from} → {data.date_to}
              </span>
            </h2>

            {/* One card, both strategies on a single shared Y axis, so a
                crossover between the lines is a real crossover. */}
            <div className="portfolio-chart">
              <MultiLineChart
                series={comparison.map(({ def, book }) => ({
                  key: def.key,
                  label: def.label,
                  points: book.equity_curve,
                  tone: def.key === "BSJP" ? "info" : "accent",
                }))}
                height={300}
              />
            </div>

            <table className="strat-compare" aria-label="Strategy comparison">
              <thead>
                <tr>
                  <th className="sc-left" scope="col">
                    STRATEGY
                  </th>
                  <th scope="col">EQUITY</th>
                  <th scope="col">P&amp;L</th>
                  <th scope="col">RET</th>
                  <th scope="col">WIN</th>
                  <th scope="col">MAX DD</th>
                  <th scope="col">TRADES</th>
                  <th scope="col">VIEW</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(({ def, book }) => {
                  const isActive = def.key === strategy;
                  return (
                    <tr key={def.key} className={isActive ? "sc-active" : undefined}>
                      <td className="sc-left">
                        <span className={`sc-key sc-tone-${def.key === "BSJP" ? "info" : "accent"}`}>
                          <span className="sc-swatch" aria-hidden="true" />
                          {def.label}
                        </span>
                        <span className="sc-blurb">{def.blurb}</span>
                      </td>
                      <td>{formatInt(book.summary.equity)}</td>
                      <td className={directionClass(book.summary.total_pnl)}>
                        {formatPnl(book.summary.total_pnl)}
                      </td>
                      <td className={directionClass(book.summary.total_pnl_pct)}>
                        {formatPct(book.summary.total_pnl_pct)}
                      </td>
                      <td>{formatPct(book.summary.win_rate)}</td>
                      <td className="val-down">{formatPct(-book.summary.max_drawdown_pct)}</td>
                      <td>{formatInt(book.summary.trades)}</td>
                      <td>
                        <button
                          type="button"
                          className={`strat-tab${isActive ? " strat-tab-active" : ""}`}
                          aria-pressed={isActive}
                          onClick={() => setStrategy(def.key)}
                          title={`Show ${def.label} trades below`}
                        >
                          {isActive ? "SHOWING" : "SHOW"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {comparison.length === 1 && (
              <p className="strat-note">
                Only the BSJP book is available, so there is nothing to compare against.
              </p>
            )}
          </section>

          <section className="portfolio-section" aria-label="Trades">
            <h2 className="portfolio-section-title">
              TRADES · {strategy}
              <span className="portfolio-section-sub">{formatInt(filtered.length)} shown</span>
            </h2>

            <div className="bsjp-filters" role="group" aria-label="Trade filter">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`btn ${filter === f.key ? "btn-active" : ""}`}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {hasColumns && filtered.length === 0 ? (
              <div className="state-block" role="status">
                {noFiltersMatch ? "No trades match this filter." : "No trades to display."}
              </div>
            ) : (
              <table className="portfolio-trades" aria-label={`${strategy} trades`}>
                <thead>
                  <tr>
                    <th scope="col" className="pf-left">
                      TICKER
                    </th>
                    <th scope="col" className="pf-left">
                      SETUP
                    </th>
                    <th scope="col" className="pf-left">
                      ENTRY DATE
                    </th>
                    <th scope="col" className="pf-left">
                      EXIT DATE
                    </th>
                    <th scope="col">ENTRY</th>
                    <th scope="col">EXIT</th>
                    <th scope="col">LOTS</th>
                    <th scope="col">P&amp;L</th>
                    <th scope="col">P&amp;L%</th>
                    <th scope="col" className="pf-left">
                      STATUS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <TradeRow key={t.id} trade={t} />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {trades.length === 0 && <EmptyState />}
        </div>
      )}
    </section>
  );
}

/**
 * One trade. An open position has no exit price and no realised P&L, so both
 * render the em dash rather than the entry's own numbers.
 */
function TradeRow({ trade }: { trade: PortfolioTrade }) {
  const open = trade.status === "OPEN";

  return (
    <tr>
      <td className="col-ticker pf-left">{trade.ticker}</td>
      <td className="pf-left" title={trade.setup}>
        {trade.setup}
      </td>
      <td className="pf-left">{trade.entry_date}</td>
      <td className="pf-left">{trade.exit_date ?? EM_DASH}</td>
      <td>{formatPrice(trade.entry)}</td>
      <td>{formatPrice(trade.exit)}</td>
      <td>{formatInt(trade.lots)}</td>
      <td className={directionClass(trade.pnl)}>{formatPnl(trade.pnl)}</td>
      <td className={directionClass(trade.pnl_pct)}>{formatPct(trade.pnl_pct)}</td>
      <td className="pf-left">
        <span className={`pf-status ${open ? "pf-open" : "pf-closed"}`}>
          {open ? "OPEN" : "CLOSED"}
        </span>
      </td>
    </tr>
  );
}

function PortfolioStat({
  label,
  value,
  sub,
  tone = "",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className={`stat-card-value ${tone}`}>{value}</div>
      <div className="stat-card-sub">{sub}</div>
    </div>
  );
}

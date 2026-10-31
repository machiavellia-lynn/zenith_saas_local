import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CandleChart } from "../components/CandleChart";
import { DatePicker, type DateRange } from "../components/DatePicker";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import {
  DEFAULT_BROKER_FILTERS,
  mockBrokers,
  mockCandlesStock,
  mockSmBm,
  mockSnapshot,
  mockTradeBook,
} from "../data/mockStock";
import type {
  BrokerBoard,
  BrokerInvestor,
  BrokerMode,
  BrokerRow,
  BrokerSummaryFilters,
  Candle,
  SmBmPanel,
  StockSnapshot,
  TradeBookRow,
} from "../types.stock";
import {
  EM_DASH,
  directionClass,
  formatInt,
  formatPrice,
  formatRatio,
} from "../lib/format";
import { orderRange } from "../lib/date";

/** Daily candles in view when the chart opens: the newest this many up to the window's end. */
export const CHART_SESSIONS = 100;

/**
 * Stock page: one symbol, one session, read as a desk would read it.
 *
 * Two rows. The first pairs the chart with the SM/BM panel at 70:30 — the chart
 * is the shape of the session, the ratios are the reading of it. The second
 * pairs the trade book with the broker summary at 50:50 — where it traded, and
 * who was on each side.
 *
 * Rendered with no props it shows `src/data/mockStock.ts`. The props below are
 * the seam: `StockRoute` passes live data in, and `onQueryChange` tells it when
 * the ticker or the session window changed so it can load the new one. This
 * component never fetches.
 */

type Status = "loading" | "ready" | "error";

/** What the controls are asking for, with the window in ISO `YYYY-MM-DD`. */
export interface StockQuery {
  ticker: string;
  from: string;
  to: string;
}

export interface StockPageProps {
  snapshot?: StockSnapshot;
  candles?: readonly Candle[];
  tradeBook?: readonly TradeBookRow[];
  smBm?: SmBmPanel;
  brokers?: readonly BrokerRow[];
  status?: Status;
  /** Called when LOAD is pressed or the session window changes. */
  onQueryChange?: (query: StockQuery) => void;
  /** A newer query is loading; the figures on screen are still the previous ones. */
  refreshing?: boolean;
  /** The last query failed; the figures on screen are still the previous ones. */
  notice?: string | null;
  /** Blocks the data source cannot feed. They say so instead of drawing an empty table. */
  missing?: { tradeBook: boolean; brokers: boolean };
}

/*
 * Number formatting follows src/lib/format.ts: dot for decimals, comma for
 * thousands. Mixing the two (a comma as both separator and decimal point)
 * made "43,51 B" sit next to "1,644" in the same table, which reads as two
 * different conventions in one column.
 */

/** Millions of IDR → a compact rupiah string ("156.2 M", "1.2 T"). */
function formatJutaCompact(value: number | null): string {
  if (value === null) return EM_DASH;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} T`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)} B`;
  return `${value.toFixed(1)} M`;
}

/** `formatJutaCompact` with an explicit "+" on gains, for figures read as a change. */
function signedJuta(value: number | null): string {
  if (value === null) return EM_DASH;
  return value > 0 ? `+${formatJutaCompact(value)}` : formatJutaCompact(value);
}

/** IDR → compact ("43.51 B"). The sign is kept for net figures. */
function formatRupiahCompact(value: number | null): string {
  if (value === null) return EM_DASH;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)} T`;
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)} B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)} M`;
  return `${sign}${formatInt(abs)}`;
}

/** Shares → compact ("89.97 M"). */
function formatShares(value: number | null): string {
  if (value === null) return EM_DASH;
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)} K`;
  return formatInt(value);
}

function signed(value: number | null, dp = 1): string {
  if (value === null) return EM_DASH;
  const s = value.toFixed(dp);
  return value > 0 ? `+${s}` : s;
}

/** A label/value cell, used by both the figure strip and the SM/BM panel. */
function Metric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="sm-cell">
      <span className="sm-cell-label">{label}</span>
      <span className={`sm-cell-value ${tone ?? ""}`} title={hint}>
        {value}
      </span>
    </div>
  );
}

/** One broker's row inside a side of the summary. */
function BrokerLine({ row, mode }: { row: BrokerRow; mode: BrokerMode }) {
  const shown = mode === "net" ? row.netValue : row.value;
  const tone = mode === "net" ? directionClass(row.netValue) : "";
  return (
    <tr>
      <td className="brk-code">{row.brokerCode}</td>
      <td className={`num ${tone}`}>{formatRupiahCompact(shown)}</td>
      <td className="num brk-dim">{formatInt(row.frequency)}</td>
    </tr>
  );
}

export default function StockPage({
  snapshot = mockSnapshot,
  candles = mockCandlesStock,
  tradeBook = mockTradeBook,
  smBm = mockSmBm,
  brokers = mockBrokers,
  status = "ready",
  onQueryChange,
  refreshing = false,
  notice = null,
  missing = { tradeBook: false, brokers: false },
}: StockPageProps = {}) {
  const [ticker, setTicker] = useState(snapshot.ticker);
  const [draft, setDraft] = useState(snapshot.ticker);
  const [filters, setFilters] = useState<BrokerSummaryFilters>(DEFAULT_BROKER_FILTERS);

  /**
   * The visible session window, seeded from the snapshot's own date.
   *
   * A single click in the picker yields from === to, which every consumer here
   * treats as one session — so "one day" is the default and the range is the
   * exception, matching how the tape is actually read.
   */
  const [range, setRange] = useState<DateRange>(() => ({
    from: snapshot.date,
    to: snapshot.date,
  }));

  // The chart is the one block with a real date axis. It gets every candle up to
  // the window's end and opens on the newest CHART_SESSIONS of them, so a
  // single-session window still has the history around it to be read against and
  // the user can drag back through the rest; the header figures and the SM/BM
  // panel describe the window itself.
  const shown = useMemo(() => {
    const [, end] = orderRange(range.from, range.to);
    return candles.filter((c) => c.date <= end);
  }, [candles, range]);

  const isSingleDay = range.from === range.to;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = draft.trim().toUpperCase();
    if (next.length === 0) return;
    setDraft(next);
    setTicker(next);
    onQueryChange?.({ ticker: next, from: range.from, to: range.to });
  };

  const onRangeChange = (next: DateRange) => {
    setRange(next);
    onQueryChange?.({ ticker, from: next.from, to: next.to });
  };

  // Totals are summed from the rows on screen, never typed in separately, so
  // the footer can never disagree with the table above it.
  const totals = useMemo(() => {
    let buyLot = 0;
    let sellLot = 0;
    let buyFreq = 0;
    let sellFreq = 0;
    for (const r of tradeBook) {
      buyLot += r.buyLot ?? 0;
      sellLot += r.sellLot ?? 0;
      buyFreq += r.buyFrequency ?? 0;
      sellFreq += r.sellFrequency ?? 0;
    }
    return { buyLot, sellLot, buyFreq, sellFreq };
  }, [tradeBook]);

  /**
   * The longest lot figure across both sides, which sets the two bar scales.
   * Bars are drawn from this so the longest row fills its half exactly.
   */
  const maxLot = useMemo(() => {
    let m = 0;
    for (const r of tradeBook) {
      m = Math.max(m, r.buyLot ?? 0, r.sellLot ?? 0);
    }
    return m || 1;
  }, [tradeBook]);

  // Filters are applied here rather than in the data module, so the same rows
  // can be re-sliced when they come from SQL instead of a mock.
  const filtered = useMemo(() => {
    return brokers.filter((b) => {
      if (filters.investor === "domestic" && b.investorGroup !== "Lokal") return false;
      if (filters.investor === "foreign" && b.investorGroup !== "Asing") return false;
      return true;
    });
  }, [brokers, filters.investor]);

  const sides = useMemo(() => {
    const buy = filtered.filter((b) => b.side === "BUY");
    const sell = filtered.filter((b) => b.side === "SELL");
    const by = (k: (r: BrokerRow) => number) => (a: BrokerRow, b: BrokerRow) => k(b) - k(a);
    const key = (r: BrokerRow) => (filters.mode === "net" ? r.netValue : r.value);
    return { buy: [...buy].sort(by(key)), sell: [...sell].sort(by(key)) };
  }, [filtered, filters.mode]);

  const changeTone = directionClass(snapshot.changePct);
  const cmTone = directionClass(smBm.netCm);
  const cmPct = useMemo(() => {
    const total = (smBm.sm ?? 0) + (smBm.bm ?? 0);
    return total > 0 ? ((smBm.sm ?? 0) / total) * 100 : null;
  }, [smBm]);

  if (status === "loading") return <LoadingState />;
  if (status === "error") return <ErrorState message="Could not load this symbol." />;

  return (
    <section className="stock-page" aria-label="Stock">
      {/* ── controls ─────────────────────────────────────────────────── */}
      <div className="stock-controls">
        <form className="stock-search" role="search" onSubmit={onSubmit}>
          <label className="stock-search-label" htmlFor="stock-ticker">
            TICKER
          </label>
          <input
            id="stock-ticker"
            className="stock-search-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            spellCheck={false}
            autoComplete="off"
            maxLength={8}
            placeholder="DSSA"
          />
          <button type="submit" className="btn">
            LOAD
          </button>
        </form>

        {/* The same picker the other pages use, so a range means the same thing
            here as it does on Chart and Flow. Steppers step one day, which is
            the session-at-a-time reading this page is built around. */}
        <DatePicker value={range} onChange={onRangeChange} label="Session range" />

        <span className="stock-controls-spacer" />

        {notice !== null && (
          <span className="stock-notice" role="alert">
            {notice}
          </span>
        )}
        <span className="stock-session" role="status">
          {refreshing ? "UPDATING…" : `${shown.length} sessions loaded`}
        </span>
      </div>

      {/* ── title + the session's one finding ────────────────────────── */}
      {/* The header describes the session in the window. On a single day that
          is the day itself; over a range the newest session in it stands for
          the window, and the label says which day that is so the figures are
          never read as belonging to the range as a whole. */}
      <div className="stock-head">
        <div className="stock-head-main">
          {/* Wired to a loader, the header names the symbol whose figures are on
              screen — not the one just typed, which may not have loaded. */}
          <h1 className="stock-head-ticker">{onQueryChange ? snapshot.ticker : ticker}</h1>
          <span className="stock-head-name">{snapshot.name}</span>
          <span className="stock-head-date">
            {isSingleDay ? range.from : `${range.from} → ${range.to}`}
          </span>
        </div>
        <div className="stock-head-price">
          <span className="stock-head-last">{formatPrice(snapshot.last)}</span>
          <span className={`stock-head-change ${changeTone}`}>
            {snapshot.changePct === null ? EM_DASH : `${signed(snapshot.changePct, 2)}%`}
          </span>
        </div>
      </div>

      <p className="stock-finding">
        {smBm.netCm === null ? (
          "No smart or bad money was recorded for this session."
        ) : (
          <>
            Clean money <span className={cmTone}>{signedJuta(smBm.netCm)}</span>
            {snapshot.frequency === null ? "" : ` on ${formatInt(snapshot.frequency)} trades`}
            {" — smart money is "}
            {cmPct === null ? EM_DASH : `${cmPct.toFixed(1)}%`}
            {" of the session's flow."}
          </>
        )}
      </p>

      <div className="stock-figures">
        <Metric label="OPEN" value={formatPrice(snapshot.open)} />
        <Metric label="HIGH" value={formatPrice(snapshot.high)} />
        <Metric label="LOW" value={formatPrice(snapshot.low)} />
        <Metric label="VWAP" value={formatPrice(snapshot.vwap)} />
        <Metric label="VOLUME" value={formatShares(snapshot.volume)} />
        <Metric label="VALUE" value={formatRupiahCompact(snapshot.value)} />
      </div>

      {/* ── row 1: chart 70 · SM/BM 30 ───────────────────────────────── */}
      <div className="stock-row stock-row-top">
        <div className="stock-block stock-block-card">
          <div className="block-head">
            <h2 className="block-title">Chart</h2>
            <span className="block-note">
              {shown.length === 0
                ? "no sessions up to this date"
                : `daily · ${shown.length} sessions · drag to pan, scroll to zoom`}
            </span>
          </div>
          {/* The plot is the card's flexible body, so the card ends where the
              plot ends. Its 376 design height only sets the chart's internal
              proportions — the SVG stretches to whatever space is left. */}
          <div className="stock-plot">
            {shown.length === 0 ? (
              <EmptyState />
            ) : (
              <CandleChart candles={shown} initialCount={CHART_SESSIONS} height={376} />
            )}
          </div>
        </div>

        <div className="stock-block stock-block-sm">
          <div className="block-head">
            <h2 className="block-title">Smart / Bad Money</h2>
            <span className="block-note">Juta</span>
          </div>

          <div className="sm-primary">
            <Metric label="SM" value={formatJutaCompact(smBm.sm)} />
            <Metric label="BM" value={formatJutaCompact(smBm.bm)} />
            <Metric label="NET CM" value={formatJutaCompact(smBm.netCm)} tone={cmTone} />
            <Metric
              label="CM STREAK"
              value={smBm.cmStreak === null ? EM_DASH : `${smBm.cmStreak}`}
              hint="Consecutive sessions of positive clean money"
            />
          </div>

          <div className="sm-primary">
            <Metric label="MF+" value={formatJutaCompact(smBm.mfPlus)} />
            <Metric label="MF−" value={formatJutaCompact(smBm.mfMinus)} />
            <Metric label="NET MF" value={formatJutaCompact(smBm.netMf)} tone={directionClass(smBm.netMf)} />
            <Metric label="TX" value={formatInt(smBm.tx)} />
          </div>

          <div className="sm-section-title">Intensity</div>
          <div className="sm-grid">
            <Metric label="RSM" value={formatRatio(smBm.intensity.rsm, 1) + "%"} />
            <Metric label="SRI" value={formatRatio(smBm.intensity.sri)} />
            <Metric label="MES" value={formatRatio(smBm.intensity.mes)} />
            <Metric label="RPR" value={formatRatio(smBm.intensity.rpr)} />
            <Metric label="ATR%" value={formatRatio(smBm.intensity.atrPct) + "%"} />
            <Metric label="VOLX GAP" value={formatRatio(smBm.intensity.volxGap)} />
          </div>

          <div className="sm-section-title">VWAP</div>
          <div className="sm-grid">
            <Metric label="VWAP SM" value={formatPrice(smBm.vwapSm)} />
            <Metric label="VWAP BM" value={formatPrice(smBm.vwapBm)} />
          </div>
        </div>
      </div>

      {/* ── row 2: trade book 50 · broker summary 50 ─────────────────── */}
      <div className="stock-row stock-row-bottom">
        <div className="stock-block stock-block-book">
          <div className="block-head">
            <h2 className="block-title">Trade Book</h2>
            <span className="block-note">by price · lots</span>
          </div>

          {missing.tradeBook ? (
            <div className="block-unavailable" role="status">
              Trade book is not available from this backend.
            </div>
          ) : (
          <div className="book-scroll">
            <table className="book-table">
              <thead>
                <tr>
                  <th className="num">Sell freq</th>
                  <th className="num">Sell lot</th>
                  <th className="num book-price-col">Price</th>
                  <th className="num">Buy lot</th>
                  <th className="num">Buy freq</th>
                </tr>
              </thead>
              <tbody>
                {tradeBook.map((r) => {
                  // Bars are sized against the widest lot on screen, so the
                  // longest row fills its half of the row. The percentage is of
                  // the *bar track*, which is the half-row width, hence the
                  // shared scale rather than a per-cell one.
                  const sellW = ((r.sellLot ?? 0) / maxLot) * 100;
                  const buyW = ((r.buyLot ?? 0) / maxLot) * 100;
                  return (
                    <tr key={r.price}>
                      <td className="num book-dim">{formatInt(r.sellFrequency)}</td>
                      <td className="num book-bar-cell">
                        <span
                          className="book-bar book-bar-sell"
                          style={{ transform: `scaleX(${sellW / 100})` }}
                        />
                        <span className="book-bar-value down">{formatInt(r.sellLot)}</span>
                      </td>
                      <td className="num book-price">{formatPrice(r.price)}</td>
                      <td className="num book-bar-cell">
                        <span
                          className="book-bar book-bar-buy"
                          style={{ transform: `scaleX(${buyW / 100})` }}
                        />
                        <span className="book-bar-value up">{formatInt(r.buyLot)}</span>
                      </td>
                      <td className="num book-dim">{formatInt(r.buyFrequency)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="num">{formatInt(totals.sellFreq)}</td>
                  <td className="num">{formatInt(totals.sellLot)}</td>
                  <td className="num">Total</td>
                  <td className="num">{formatInt(totals.buyLot)}</td>
                  <td className="num">{formatInt(totals.buyFreq)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </div>

        <div className="stock-block stock-block-broker">
          {/* The controls sit in the head row rather than on their own line.
              On their own line they made this card 40px taller than the trade
              book beside it, and the shorter card then stretched — which is
              the hole that appeared under the trade book's last row. */}
          <div className="block-head block-head-broker">
            <h2 className="block-title">Broker Summary</h2>

            {!missing.brokers && (
            <div className="brk-controls">
              <div className="brk-switch" role="group" aria-label="Value or net">
                {(["gross", "net"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`brk-switch-btn ${filters.mode === m ? "brk-switch-on" : ""}`}
                    aria-pressed={filters.mode === m}
                    onClick={() => setFilters((f) => ({ ...f, mode: m }))}
                  >
                    {m === "gross" ? "GROSS" : "NET"}
                  </button>
                ))}
              </div>

              <label className="brk-select-wrap">
                <span className="brk-select-label">Board</span>
                <select
                  className="brk-select"
                  value={filters.board}
                  onChange={(e) => setFilters((f) => ({ ...f, board: e.target.value as BrokerBoard }))}
                >
                  <option value="all">All Market</option>
                  <option value="regular">Regular</option>
                  <option value="tunai">Tunai</option>
                  <option value="nego">Nego</option>
                </select>
              </label>

              <label className="brk-select-wrap">
                <span className="brk-select-label">Investor</span>
                <select
                  className="brk-select"
                  value={filters.investor}
                  onChange={(e) => setFilters((f) => ({ ...f, investor: e.target.value as BrokerInvestor }))}
                >
                  <option value="all">All Investor</option>
                  <option value="domestic">Domestic</option>
                  <option value="foreign">Foreign</option>
                </select>
              </label>
            </div>
            )}
          </div>

          {missing.brokers ? (
            <div className="block-unavailable" role="status">
              Broker summary is not available from this backend.
            </div>
          ) : (
          <div className="brk-cols">
            {(["BUY", "SELL"] as const).map((side) => {
              const rows = side === "BUY" ? sides.buy : sides.sell;
              return (
                <div className="brk-col" key={side}>
                  <div className="brk-col-head">
                    <span className="brk-col-title">{side}</span>
                    <span className="brk-col-note">{rows.length} brokers</span>
                  </div>
                  <table className="brk-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th className="num">{filters.mode === "net" ? "Net" : "Value"}</th>
                        <th className="num">Freq</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="brk-empty">
                            No brokers match these filters.
                          </td>
                        </tr>
                      ) : (
                        rows.map((r) => <BrokerLine key={r.brokerCode} row={r} mode={filters.mode} />)
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>
    </section>
  );
}

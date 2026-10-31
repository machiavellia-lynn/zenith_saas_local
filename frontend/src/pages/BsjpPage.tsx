import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BsjpSetup, BsjpSignal, BsjpSignalsResponse } from "../types.pages";
import { fetchBsjp as defaultFetchBsjp } from "../data/pages";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { DatePicker, type DateRange } from "../components/DatePicker";
import { displayToIso, withinRange } from "../lib/date";
import {
  EM_DASH,
  directionClass,
  formatInt,
  formatPrice,
  formatRatio,
} from "../lib/format";

type Status = "loading" | "ready" | "error";

/** The filter is "All" or exactly one of the closed setup set. */
type SetupFilter = "ALL" | BsjpSetup;

/** Ordering. Score is the default key; rank breaks ties the way the backend did. */
type SortKey = "score" | "rr" | "rank";
type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { key: "score", dir: "desc" };

/**
 * Readable short forms for the setup identifiers.
 *
 * The API's values are internal names (`SMA5_BREAKOUT_V13`); a scanner row has
 * room for about ten characters, so the table prints the short form and carries
 * the full identifier in the cell's `title` — nothing is lost, it is one hover
 * away. Typed as Record<BsjpSetup, string>, so adding a setup to the closed set
 * without labelling it here is a type error rather than a blank cell.
 */
const SETUP_LABELS: Record<BsjpSetup, string> = {
  SMA5_BREAKOUT_V13: "SMA5 BRK",
  POWER_BREAK_V21: "POWER BRK",
};

/** Never render undefined: an unknown setup still gets a readable label. */
function setupLabel(setup: BsjpSetup): string {
  return SETUP_LABELS[setup] ?? setup.replace(/_/g, " ");
}

interface Column {
  key: string;
  label: string;
  /** Left-aligned text column rather than a right-aligned numeric one. */
  text?: boolean;
  title?: string;
}

/** Column order mirrors the order a scanner is read in: who, what, then levels. */
const COLUMNS: Column[] = [
  { key: "rank", label: "RANK", title: "Day rank within the scan" },
  { key: "ticker", label: "TICKER", text: true },
  { key: "setup", label: "SETUP", text: true, title: "Signal setup" },
  { key: "entry", label: "ENTRY", title: "Entry price, IDR" },
  { key: "tp1", label: "TP1", title: "First target, IDR" },
  { key: "tp2", label: "TP2", title: "Second target, IDR" },
  { key: "sl", label: "SL", title: "Stop loss, IDR" },
  { key: "sl_type", label: "SL TYPE", text: true, title: "How the stop is derived" },
  { key: "score", label: "SCORE", title: "Ranking score" },
  { key: "rr", label: "R:R", title: "Reward/risk to TP1 = (TP1 − ENTRY) / (ENTRY − SL)" },
  { key: "lots", label: "LOTS", title: "Position size at the configured lot budget" },
];

/**
 * Reward/risk to the first target.
 *
 * Null unless every input is present *and* the trade has a defined risk — an
 * entry at or above its stop (or a zero-sized position) has no ratio, so it
 * renders the em dash rather than Infinity or NaN.
 */
function rewardRisk(signal: BsjpSignal): number | null {
  const { entry, tp1, sl } = signal;
  if (entry === null || tp1 === null || sl === null) return null;
  const risk = entry - sl;
  if (risk <= 0) return null;
  return (tp1 - entry) / risk;
}

/** Rank through the nulls: an unranked signal is always last, in either direction. */
function compareRank(a: BsjpSignal, b: BsjpSignal, dir: SortDir): number {
  const ar = a.day_rank;
  const br = b.day_rank;
  if (ar === null && br === null) return 0;
  if (ar === null) return 1;
  if (br === null) return -1;
  return dir === "desc" ? br - ar : ar - br;
}

/**
 * Sort by the active key, nulls last in both directions.
 *
 * Only RANK is a total order — score and R:R both tie constantly — so RANK is
 * the final tiebreaker and the ordering is deterministic across renders.
 */
function sortSignals(rows: readonly BsjpSignal[], sort: SortState): BsjpSignal[] {
  const dir = sort.dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const primary = (() => {
      if (sort.key === "rank") return compareRank(a, b, sort.dir);
      const av = sort.key === "score" ? a.score : rewardRisk(a);
      const bv = sort.key === "score" ? b.score : rewardRisk(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    })();

    return primary !== 0 ? primary : compareRank(a, b, "asc");
  });
}

/** A score with four decimals of significance, trimmed to what a scanner needs. */
function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return value.toFixed(2);
}

export interface BsjpPageProps {
  /** Injectable data access, so states can be exercised without a network. */
  fetchBsjp?: typeof defaultFetchBsjp;
}

/**
 * BSJP scanner: the day's signals, ranked.
 *
 * The page owns no derived fetches — one request fills the table, and every
 * control below (setup filter, sort, the stat strip) is a pure function of the
 * rows already in memory.
 */
export default function BsjpPage({ fetchBsjp = defaultFetchBsjp }: BsjpPageProps = {}) {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<BsjpSignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SetupFilter>("ALL");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  /** The scan's own date. Seeded once from `date`, DD-MM-YYYY in the payload. */
  const [range, setRange] = useState<DateRange | null>(null);

  const loadId = useRef(0);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setStatus("loading");
    setError(null);
    setData(null);
    const res = await fetchBsjp();
    if (id !== loadId.current) return; // a newer request won
    if (res.status === "error" || res.data === null) {
      setStatus("error");
      setError(res.error ?? "Unknown error");
      return;
    }
    setData(res.data);
    setStatus("ready");
  }, [fetchBsjp]);

  useEffect(() => {
    void load();
  }, [load]);

  const signals = useMemo(() => data?.signals ?? [], [data]);

  // Seed the picker from the scan's own date, once.
  useEffect(() => {
    if (range !== null || data === null) return;
    const iso = displayToIso(data.date);
    if (iso !== null) setRange({ from: iso, to: iso });
  }, [data, range]);

  /**
   * NOT a range filter.
   *
   * The scanner emits one snapshot per run, and every signal shares its `date`,
   * so there is nothing per-row to filter on. The picker is a snapshot *date
   * selector*: it names the session being read. A picked range that misses the
   * snapshot leaves the table untouched and states the mismatch in the toolbar
   * — an empty scanner would be misread as "no setups fired today".
   */
  const snapshotIso = useMemo(
    () => (data === null ? null : displayToIso(data.date)),
    [data],
  );

  const outOfRange = useMemo(() => {
    if (range === null || snapshotIso === null) return false;
    return !withinRange(snapshotIso, range.from, range.to);
  }, [range, snapshotIso]);

  /**
   * The setups offered by the filter: the closed set, plus anything the payload
   * carries that the type does not know about. A filter that cannot reach a row
   * the table is showing would be a lie.
   */
  const setups = useMemo(() => {
    const seen: BsjpSetup[] = [];
    for (const s of signals) {
      if (!seen.includes(s.setup)) seen.push(s.setup);
    }
    return seen;
  }, [signals]);

  const visible = useMemo(
    () => (filter === "ALL" ? signals : signals.filter((s) => s.setup === filter)),
    [signals, filter],
  );

  const sorted = useMemo(() => sortSignals(visible, sort), [visible, sort]);

  const stats = useMemo(() => {
    let best: number | null = null;
    let rrTotal = 0;
    let rrCount = 0;

    for (const s of signals) {
      const rr = rewardRisk(s);
      if (s.score !== null && Number.isFinite(s.score) && (best === null || s.score > best)) {
        best = s.score;
      }
      if (rr !== null) {
        rrTotal += rr;
        rrCount += 1;
      }
    }

    return {
      count: signals.length,
      setups: setups.length,
      best,
      avgRr: rrCount > 0 ? rrTotal / rrCount : null,
    };
  }, [signals, setups]);

  const onSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : // A newly chosen column starts descending: both values read
          // largest-first in a scanner.
          { key, dir: "desc" },
    );
  };

  /** Arrow target for the score header, mirroring the flow table's idiom. */
  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" => {
    if (sort.key !== key) return "none";
    return sort.dir === "asc" ? "ascending" : "descending";
  };

  return (
    <section className="bsjp-page" aria-label="BSJP scanner">
      {status === "loading" && <LoadingState />}

      {status === "error" && error !== null && (
        <ErrorState message={error} onRetry={() => void load()} />
      )}

      {status === "ready" && (
        <>
          {/* See `outOfRange`: this selects the snapshot date, it does not
              filter rows. Left as-is so the next reader does not "fix" it into
              a filter that blanks a single-day scan. */}
          <div className="page-toolbar">
            {range !== null && (
              <DatePicker value={range} onChange={setRange} label="Scan date" />
            )}
            <span className="page-toolbar-spacer" />
            <span className="page-toolbar-note">
              {data !== null && data.signals.length > 0 && outOfRange
                ? `Snapshot ${data.date} · outside selected range`
                : `Snapshot ${data === null ? EM_DASH : data.date}`}
            </span>
          </div>

          <div className="stat-strip" role="region" aria-label="BSJP summary">
            <BsjpStat label="SIGNALS" value={formatInt(stats.count)} sub="in scan" />
            <BsjpStat label="SETUPS" value={formatInt(stats.setups)} sub="represented" />
            <BsjpStat
              label="BEST SCORE"
              value={formatScore(stats.best)}
              sub="highest ranked"
              tone={stats.best === null ? "" : "val-up"}
            />
            <BsjpStat
              label="AVG R:R"
              value={formatRatio(stats.avgRr)}
              sub="to TP1"
              tone={stats.avgRr === null ? "" : directionClass(stats.avgRr)}
            />
          </div>

          <div className="bsjp-filters" role="group" aria-label="Setup filter">
            <button
              type="button"
              className={`btn ${filter === "ALL" ? "btn-active" : ""}`}
              aria-pressed={filter === "ALL"}
              onClick={() => setFilter("ALL")}
            >
              ALL
            </button>
            {setups.map((s) => (
              <button
                key={s}
                type="button"
                className={`btn ${filter === s ? "btn-active" : ""}`}
                aria-pressed={filter === s}
                title={s}
                onClick={() => setFilter(s)}
              >
                {setupLabel(s)}
              </button>
            ))}
          </div>

          {signals.length === 0 ? (
            <EmptyState />
          ) : sorted.length === 0 ? (
            <div className="state-block" role="status">
              No signals for this setup.
            </div>
          ) : (
            <div className="bsjp-body">
              <table className="bsjp-table">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => {
                      // Only RANK, SCORE and R:R are orderable; the other
                      // headers get no click handler and no aria-sort, so they
                      // are not announced as controls that do nothing.
                      const sortKey: SortKey | null =
                        col.key === "rank" || col.key === "score" || col.key === "rr"
                          ? col.key
                          : null;
                      const active = sortKey !== null && sort.key === sortKey;

                      return (
                        <th
                          key={col.key}
                          scope="col"
                          className={[col.text ? "bsjp-left" : "", active ? "sorted" : ""]
                            .filter((c) => c.length > 0)
                            .join(" ")}
                          title={col.title}
                          aria-sort={sortKey === null ? undefined : ariaSort(sortKey)}
                          onClick={sortKey === null ? undefined : () => onSort(sortKey)}
                        >
                          {col.label}
                          <span className="sort-ind" aria-hidden="true">
                            {active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => {
                    const rr = rewardRisk(s);
                    return (
                      <tr key={s.id}>
                        <td>{formatInt(s.day_rank)}</td>
                        <td className="col-ticker">{s.ticker}</td>
                        <td className="bsjp-left">
                          <span className="bsjp-setup" title={s.setup}>
                            {setupLabel(s.setup)}
                          </span>
                        </td>
                        {/* Entry is the reference the levels are measured
                            against, so it stays the neutral text colour: only
                            the levels themselves carry direction. */}
                        <td>{formatPrice(s.entry)}</td>
                        <td className="val-up">{formatPrice(s.tp1)}</td>
                        <td className="val-up">{formatPrice(s.tp2)}</td>
                        <td className="val-down">{formatPrice(s.sl)}</td>
                        <td className="bsjp-left">{s.sl_type ?? EM_DASH}</td>
                        <td
                          className={
                            s.score === null ? "val-null" : directionClass(s.score)
                          }
                        >
                          {formatScore(s.score)}
                        </td>
                        <td className={rr === null ? "val-null" : ""}>{formatRatio(rr)}</td>
                        <td>{formatInt(s.lot_size)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function BsjpStat({
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

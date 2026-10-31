import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SectorResponse, SectorRow } from "../types.pages";
import type { TickerRow } from "../types";
import { fetchSector as defaultFetchSector } from "../data/pages";
import { SECTOR_MEMBERS } from "../data/sectors";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { DatePicker, type DateRange } from "../components/DatePicker";
import { displayToIso, withinRange } from "../lib/date";
import {
  EM_DASH,
  directionClass,
  formatInt,
  formatJuta,
  formatPct,
  formatPrice,
  formatRatio,
} from "../lib/format";

type Status = "loading" | "ready" | "error";

/** Columns the table can sort by. Monetary fields are Juta. */
type SectorSortKey =
  | "name"
  | "sm_val"
  | "bm_val"
  | "cm"
  | "mf_plus"
  | "mf_minus"
  | "net_mf"
  | "gain_pct"
  | "ticker_count";

type SortDir = "asc" | "desc";

interface SectorSortState {
  key: SectorSortKey;
  dir: SortDir;
}

/** The backend orders /api/sector by clean money descending; first paint matches. */
const DEFAULT_SECTOR_SORT: SectorSortState = { key: "cm", dir: "desc" };

interface Column {
  key: SectorSortKey;
  label: string;
  /** Left-aligned text column rather than a right-aligned numeric one. */
  text?: boolean;
  title?: string;
}

const COLUMNS: Column[] = [
  { key: "name", label: "SECTOR", text: true },
  { key: "sm_val", label: "SM", title: "Smart money value, Juta" },
  { key: "bm_val", label: "BM", title: "Bad money value, Juta" },
  { key: "cm", label: "NET CM", title: "Clean money = SM − BM, Juta" },
  { key: "mf_plus", label: "MF+", title: "Money flow in, Juta" },
  { key: "mf_minus", label: "MF−", title: "Money flow out, Juta" },
  { key: "net_mf", label: "NET MF", title: "Net money flow, Juta" },
  { key: "gain_pct", label: "GAIN%", title: "Session gain, %" },
  { key: "ticker_count", label: "#TICKERS", title: "Member tickers in this sector" },
];

/** Columns whose values are numeric (or nullable-numeric). */
const NUMERIC_KEYS: ReadonlySet<SectorSortKey> = new Set<SectorSortKey>([
  "sm_val",
  "bm_val",
  "cm",
  "mf_plus",
  "mf_minus",
  "net_mf",
  "gain_pct",
  "ticker_count",
]);

type SortValue = number | string | null;

function valueFor(row: SectorRow, key: SectorSortKey): SortValue {
  if (key === "name") return row.name;
  return row[key];
}

/**
 * Compare two sector rows.
 *
 * Nulls sort last in BOTH directions — a missing metric is "no information",
 * and letting it head a descending sort would read as a leading value. Same
 * rule as src/lib/sort.ts, which is typed to TickerRow and so cannot take a
 * SectorRow.
 */
function compareSectors(a: SectorRow, b: SectorRow, sort: SectorSortState): number {
  const av = valueFor(a, sort.key);
  const bv = valueFor(b, sort.key);

  const aNull = av === null || av === undefined;
  const bNull = bv === null || bv === undefined;

  if (aNull && bNull) return a.name.localeCompare(b.name, "en");
  if (aNull) return 1;
  if (bNull) return -1;

  const dir = sort.dir === "asc" ? 1 : -1;

  if (NUMERIC_KEYS.has(sort.key)) {
    const an = av as number;
    const bn = bv as number;
    if (an !== bn) return an < bn ? -dir : dir;
    return a.name.localeCompare(b.name, "en");
  }

  const cmp = String(av).localeCompare(String(bv), "en", { sensitivity: "base" });
  if (cmp !== 0) return cmp * dir;
  return a.name.localeCompare(b.name, "en");
}

/** Sort a copy; never mutates the input. */
function sortSectors(rows: readonly SectorRow[], sort: SectorSortState): SectorRow[] {
  return [...rows].sort((a, b) => compareSectors(a, b, sort));
}

/**
 * Next sort state when a header is clicked: same column toggles direction, a
 * new column starts at its natural direction (numbers descending-first).
 */
function nextSectorSort(current: SectorSortState, key: SectorSortKey): SectorSortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: NUMERIC_KEYS.has(key) ? "desc" : "asc" };
}

/** Compact signed Juta, using the shared formatter for single-unit columns. */
function jutaOrDash(v: number | null): string {
  return formatJuta(v);
}

/**
 * SM vs BM as a share of the row's traded value. Both sides are stored as
 * positive Juta, so the split is sm / (sm + bm) — the bar shows which side of
 * the flow a sector's value came from, not a diffs magnitude.
 */
function smShare(row: SectorRow): number | null {
  const total = row.sm_val + row.bm_val;
  if (!Number.isFinite(total) || total <= 0) return null;
  return (row.sm_val / total) * 100;
}

/**
 * The expanded sector body: that sector's member tickers in a table shaped
 * like the Flow page, minus PHASE and ACTION (the owner asked for exactly
 * those two to be dropped).
 *
 * Rows come from the flow snapshot when a member is present in it; a member
 * with no flow row that day still lists, with em dashes, so the sector's
 * membership is never silently understated.
 */
function SectorMemberTable({
  members,
  rows,
  sectorName,
}: {
  members: readonly string[];
  rows: readonly TickerRow[];
  sectorName: string;
}) {
  const byTicker = useMemo(() => {
    const m = new Map<string, TickerRow>();
    for (const r of rows) m.set(r.ticker, r);
    return m;
  }, [rows]);

  const ordered = useMemo(
    () =>
      members
        .map((t) => byTicker.get(t))
        .filter((r): r is TickerRow => r !== undefined)
        .sort((a, b) => (b.clean_money ?? 0) - (a.clean_money ?? 0)),
    [members, byTicker],
  );

  if (ordered.length === 0) {
    return (
      <span className="stat-card-sub">
        No flow data for this sector's members.
      </span>
    );
  }

  return (
    <table className="sector-member-table" aria-label={`${sectorName} members`}>
      <thead>
        <tr>
          <th className="col-left">TICKER</th>
          <th>PRICE</th>
          <th>CHG%</th>
          <th>SM</th>
          <th>BM</th>
          <th>NET CM</th>
          <th>RSM</th>
          <th>TX</th>
        </tr>
      </thead>
      <tbody>
        {ordered.map((r) => (
          <tr key={r.ticker}>
            <td className="col-left col-ticker">{r.ticker}</td>
            <td>{formatPrice(r.price)}</td>
            <td className={directionClass(r.gain_pct)}>{formatPct(r.gain_pct)}</td>
            <td className={directionClass(r.sm_val)}>{formatJuta(r.sm_val)}</td>
            <td className={directionClass(r.bm_val)}>{formatJuta(r.bm_val)}</td>
            <td className={directionClass(r.clean_money)}>{formatJuta(r.clean_money)}</td>
            <td>{r.rsm === null ? EM_DASH : `${formatRatio(r.rsm, 1)}%`}</td>
            <td>{formatInt(r.tx)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One stat in the top strip. Mirrors the StatStrip card idiom. */
function SectorStat({
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

export interface SectorPageProps {
  /** Injectable data access, so states can be exercised without a network. */
  fetchSector?: typeof defaultFetchSector;
  /**
   * The flow snapshot, used to fill the expanded member table. Passed in
   * rather than fetched here so the Flow page and this page share one read of
   * the same data.
   */
  flowRows?: readonly TickerRow[];
}

/** Sector rotation: where the clean money went, sector by sector. */
export default function SectorPage({
  fetchSector = defaultFetchSector,
  flowRows = [],
}: SectorPageProps = {}) {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<SectorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SectorSortState>(DEFAULT_SECTOR_SORT);
  const [expanded, setExpanded] = useState<string | null>(null);
  /**
   * The snapshot's own window. Seeded once from the payload's `date_from` /
   * `date_to`, which arrive as DD-MM-YYYY while the picker works in ISO.
   */
  const [range, setRange] = useState<DateRange | null>(null);

  const loadId = useRef(0);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setStatus("loading");
    setError(null);
    setData(null);
    const res = await fetchSector();
    if (id !== loadId.current) return;
    if (res.status === "error" || res.data === null) {
      setStatus("error");
      setError(res.error ?? "Unknown error");
      return;
    }
    setData(res.data);
    setStatus("ready");
  }, [fetchSector]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.sectors ?? [];
  const sorted = useMemo(() => sortSectors(rows, sort), [rows, sort]);

  // Seed the picker from the snapshot's own dates, once.
  useEffect(() => {
    if (range !== null || data === null) return;
    const from = displayToIso(data.date_from);
    const to = displayToIso(data.date_to);
    if (from !== null && to !== null) setRange({ from, to });
  }, [data, range]);

  /**
   * NOT a range filter.
   *
   * /api/sector returns a single-day snapshot: every row carries the same
   * session date, so there is no per-row date to filter on. The picker here is
   * a snapshot *date selector* — it tells the operator which session they are
   * looking at. When the picked range does not cover the snapshot, the table
   * still renders in full and the toolbar says so out loud; silently blanking
   * the table would read as "no clean money moved" rather than "wrong day".
   */
  const snapshotIso = useMemo(() => {
    if (data === null) return null;
    return displayToIso(data.date_to) ?? displayToIso(data.date_from);
  }, [data]);

  /** The snapshot falls outside the picked window, so the note must explain. */
  const outOfRange = useMemo(() => {
    if (range === null || snapshotIso === null) return false;
    return !withinRange(snapshotIso, range.from, range.to);
  }, [range, snapshotIso]);

  const stats = useMemo(() => {
    let netCm = 0;
    let netMf: number | null = null;
    let topName: string | null = null;
    let topCm: number | null = null;
    let cmKnown = false;

    for (const r of rows) {
      if (Number.isFinite(r.cm)) {
        netCm += r.cm;
        cmKnown = true;
      }
      if (r.net_mf !== null && Number.isFinite(r.net_mf)) {
        netMf = (netMf ?? 0) + r.net_mf;
      }
      if (r.cm !== null && Number.isFinite(r.cm) && (topCm === null || r.cm > topCm)) {
        topCm = r.cm;
        topName = r.name;
      }
    }

    return {
      netCm: cmKnown ? netCm : null,
      netMf,
      topName,
      topCm,
      count: rows.length,
    };
  }, [rows]);

  const membersOf = (name: string): readonly string[] => SECTOR_MEMBERS[name] ?? [];

  return (
    <section className="sector-page" aria-label="Sector rotation">
      {status === "loading" && <LoadingState />}

      {status === "error" && error !== null && (
        <ErrorState message={error} onRetry={() => void load()} />
      )}

      {status === "ready" && (
        <>
          {/* See `outOfRange`: the picker selects the snapshot date, it does
              not filter the rows. Left as-is so the next reader does not
              "fix" it into a filter that blanks a single-day table. */}
          <div className="page-toolbar">
            {range !== null && (
              <DatePicker value={range} onChange={setRange} label="Sector snapshot date" />
            )}
            <span className="page-toolbar-spacer" />
            <span className="page-toolbar-note">
              {data !== null && data.sectors.length > 0 && outOfRange
                ? `Snapshot ${data.date_to} · outside selected range`
                : `Snapshot ${data === null ? EM_DASH : data.date_to}`}
            </span>
          </div>

          <div className="stat-strip" role="region" aria-label="Sector totals">
            <SectorStat
              label="NET CM"
              value={jutaOrDash(stats.netCm)}
              sub="all sectors"
              tone={directionClass(stats.netCm)}
            />
            <SectorStat
              label="NET MF"
              value={jutaOrDash(stats.netMf)}
              sub="all sectors"
              tone={directionClass(stats.netMf)}
            />
            <SectorStat
              label="TOP SECTOR · CM"
              value={stats.topName ?? EM_DASH}
              sub={stats.topCm === null ? EM_DASH : `${formatJuta(stats.topCm)} Juta`}
            />
            <SectorStat label="SECTORS" value={formatInt(stats.count)} sub="in view" />
            <SectorStat
              label="WINDOW"
              value={data === null || rows.length === 0 ? EM_DASH : data.date_to}
              sub={data === null || rows.length === 0 ? EM_DASH : `from ${data.date_from}`}
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="sector-body">
              {/* n/a for sort documents a click-to-sort header that is not
                  currently the active column. */}
              <table className="sector-table" aria-label="Sector rotation">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => {
                      const active = sort.key === col.key;
                      return (
                        <th
                          key={col.key}
                          scope="col"
                          className={active ? "sorted" : undefined}
                          style={col.text ? { textAlign: "left" } : undefined}
                          title={col.title}
                          aria-sort={
                            active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                          }
                          onClick={() => setSort(nextSectorSort(sort, col.key))}
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
                {/* The bar is a real but purely visual row, so the header
                    roles must not announce it as sector data. */}
                <tbody style={{ display: "contents" }} role="presentation">
                  {sorted.map((row) => {
                    const isOpen = row.name === expanded;
                    const share = smShare(row);
                    const members = membersOf(row.name);
                    return (
                      <Fragment key={row.name}>
                        <tr
                          className={`sector-row${isOpen ? " sector-row-open" : ""}`}
                          aria-expanded={isOpen}
                          onClick={() => setExpanded(isOpen ? null : row.name)}
                        >
                          <td className="col-sector">
                            <span className="sector-name">{row.name}</span>
                            <span className="sector-caret" aria-hidden="true">
                              {isOpen ? "▾" : "▸"}
                            </span>
                          </td>
                          <td className="col-sm-cell">
                            {/* The bar sits inline with the SM figure so the row
                                stays one line. Both segments are drawn: the
                                green width is the SM share, the remainder is BM,
                                so a 30/70 sector reads as 30% green. */}
                            <span className="cell-with-bar">
                              <span
                                className="sm-bm-bar"
                                role="img"
                                aria-label={`SM ${formatJuta(row.sm_val)} vs BM ${formatJuta(
                                  row.bm_val,
                                )} Juta`}
                              >
                                <span
                                  className="sm-bm-bar-sm"
                                  style={{ width: `${share === null ? 0 : share}%` }}
                                />
                                <span
                                  className="sm-bm-bar-bm"
                                  style={{ width: `${share === null ? 0 : 100 - share}%` }}
                                />
                              </span>
                              <span className="cell-bar-value">{formatJuta(row.sm_val)}</span>
                            </span>
                          </td>
                          <td>{formatJuta(row.bm_val)}</td>
                          <td className={directionClass(row.cm)}>{formatJuta(row.cm)}</td>
                          <td>{formatJuta(row.mf_plus)}</td>
                          <td>{formatJuta(row.mf_minus)}</td>
                          <td className={directionClass(row.net_mf)}>{formatJuta(row.net_mf)}</td>
                          <td className={directionClass(row.gain_pct)}>
                            {formatPct(row.gain_pct)}
                          </td>
                          <td>{formatInt(row.ticker_count)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="sector-members-row">
                            <td className="sector-members" colSpan={COLUMNS.length}>
                              <div className="sector-members-title">
                                {row.name} · {formatInt(members.length)} MEMBERS
                              </div>
                              {members.length === 0 ? (
                                <span className="stat-card-sub">
                                  No member tickers recorded for this sector.
                                </span>
                              ) : (
                                <SectorMemberTable
                                  members={members}
                                  rows={flowRows}
                                  sectorName={row.name}
                                />
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
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

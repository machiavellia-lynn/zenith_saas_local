import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlowResponse, TickerRow, TransactionsResponse } from "./types";
import {
  fetchFlow as defaultFetchFlow,
  fetchTransactions as defaultFetchTransactions,
  isMockMode,
} from "./data";
import { Nav, useRoute } from "./components/Nav";
import { StatStrip } from "./components/StatStrip";
import { TickerTable } from "./components/TickerTable";
import { DetailPanel } from "./components/DetailPanel";
import { EmptyState, ErrorState, LoadingState } from "./components/States";
import { DatePicker, type DateRange } from "./components/DatePicker";
import { DEFAULT_SORT, sortRows, type SortState } from "./lib/sort";
import { displayToIso, isoToDisplay, orderRange, withinRange } from "./lib/date";
import {
  DEFAULT_STRUCTURE_KEYS,
  normaliseStructureKeys,
} from "./lib/structure";
import HubPage from "./pages/HubPage";
import StockRoute from "./pages/StockRoute";
import SectorPage from "./pages/SectorPage";
import BsjpPage from "./pages/BsjpPage";
import PortfolioPage from "./pages/PortfolioPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";

type Status = "loading" | "ready" | "error";
type Density = "compact" | "comfortable";

const DENSITY_KEY = "zenith-density";
const AUTH_KEY = "zenith-auth";
const STRUCTURE_KEY = "zenith-structure-metrics";

export interface AppProps {
  /** Injectable data access, so states can be exercised without a network. */
  fetchFlow?: typeof defaultFetchFlow;
  fetchTransactions?: typeof defaultFetchTransactions;
  /** Start signed in. Tests pass true; the default reads sessionStorage. */
  initialAuthed?: boolean;
}

function readDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    return v === "comfortable" ? "comfortable" : "compact";
  } catch {
    return "compact";
  }
}

function readAuthed(): boolean {
  try {
    return sessionStorage.getItem(AUTH_KEY) === "1";
  } catch {
    return false;
  }
}

/** Restore the STRUCTURE metric selection, tolerating absent or corrupt data. */
function readStructureKeys(): string[] {
  try {
    const raw = localStorage.getItem(STRUCTURE_KEY);
    if (raw === null) return [...DEFAULT_STRUCTURE_KEYS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_STRUCTURE_KEYS];
    return normaliseStructureKeys(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    return [...DEFAULT_STRUCTURE_KEYS];
  }
}

/* ── The Flow page lives here: it owns the table/detail-panel interaction ── */

interface FlowPageProps {
  fetchFlow: typeof defaultFetchFlow;
  fetchTransactions: typeof defaultFetchTransactions;
}

function FlowPage({ fetchFlow, fetchTransactions }: FlowPageProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [selected, setSelected] = useState<string | null>(null);
  const [tape, setTape] = useState<TransactionsResponse | null>(null);
  const [structureKeys, setStructureKeys] = useState<string[]>(readStructureKeys);
  /** The window the snapshot claims to cover. Seeded once from the payload. */
  const [range, setRange] = useState<DateRange | null>(null);
  /** A picked window is loading; the table still shows the previous one. */
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Which window request is current; an older reply must not overwrite a newer one. */
  const windowSeq = useRef(0);

  // The STRUCTURE metric choice is a user preference, so it persists.
  useEffect(() => {
    try {
      localStorage.setItem(STRUCTURE_KEY, JSON.stringify(structureKeys));
    } catch {
      /* storage unavailable — the choice simply does not persist */
    }
  }, [structureKeys]);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    const res = await fetchFlow();
    if (res.status === "error") {
      setStatus("error");
      setError(res.error);
      setFlow(null);
      return;
    }
    setFlow(res.data);
    setStatus("ready");
  }, [fetchFlow]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Live, the picked window is a real query: the backend sums the flow over it.
   * The table stays on screen while the new window loads (unmounting it would
   * drop the picker mid-click) and a failure leaves the previous window up with
   * a notice.
   */
  const reloadWindow = useCallback(
    async (next: DateRange) => {
      const id = ++windowSeq.current;
      setRefreshing(true);
      setNotice(null);
      const [from, to] = orderRange(next.from, next.to);
      const res = await fetchFlow({ from: isoToDisplay(from), to: isoToDisplay(to) });
      if (id !== windowSeq.current) return;
      setRefreshing(false);
      if (res.status === "ready" && res.data !== null) {
        setFlow(res.data);
        return;
      }
      setNotice(res.error ?? "Could not load that window.");
    },
    [fetchFlow],
  );

  const onRangeChange = useCallback(
    (next: DateRange) => {
      setRange(next);
      if (!isMockMode()) void reloadWindow(next);
    },
    [reloadWindow],
  );

  // Seed the picker from the payload's own window, once. The API reports
  // DD-MM-YYYY while the picker works in ISO, so the dates are converted.
  useEffect(() => {
    if (range !== null || flow === null) return;
    const from = displayToIso(flow.date_from);
    const to = displayToIso(flow.date_to);
    if (from !== null && to !== null) setRange({ from, to });
  }, [flow, range]);

  /**
   * The picked window does NOT filter the table, and that is deliberate.
   *
   * A flow row (`TickerRow`) carries no date at all: the mock — like `/api/flow`
   * in the reference — is a SINGLE-DAY snapshot whose only dates are the
   * payload-level `date_from`/`date_to`. There is nothing per row to compare
   * against a range, so hiding rows would be inventing a filter the data cannot
   * answer. Instead the toolbar says out loud when the picked window misses the
   * snapshot's own date, and the snapshot stays on screen.
   *
   * Do not "fix" this into a `rows.filter(...)` if a date field ever appears on
   * TickerRow — that would be a data-contract change and needs the real API
   * behind it first.
   *
   * Live, the real API is behind it: picking a window re-queries `/api/flow`
   * for that window (`reloadWindow`), so the snapshot then covers what was
   * picked. Offline the mock cannot answer a window, and this note applies.
   */
  /** A window with no SM/BM anywhere (before the chat history starts): prices only. */
  const noFlowRecorded =
    flow !== null && flow.totals.count > 0 && flow.totals.sm === 0 && flow.totals.bm === 0;
  const snapshotIso = flow === null ? null : displayToIso(flow.date_from);
  const outsideSnapshot =
    range !== null && snapshotIso !== null && !withinRange(snapshotIso, range.from, range.to);

  // The tape covers the same window as the table above it.
  const tapeFrom = flow?.date_from;
  const tapeTo = flow?.date_to;
  useEffect(() => {
    if (selected === null) {
      setTape(null);
      return;
    }
    let cancelled = false;
    setTape(null);
    const win = tapeFrom !== undefined && tapeTo !== undefined ? { from: tapeFrom, to: tapeTo } : undefined;
    void fetchTransactions(selected, win).then((res) => {
      if (!cancelled) setTape(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, fetchTransactions, tapeFrom, tapeTo]);

  const rows = useMemo(
    () => (flow === null ? [] : sortRows(flow.tickers, sort)),
    [flow, sort],
  );

  const selectedRow = useMemo(
    () => (selected === null ? null : rows.find((r) => r.ticker === selected) ?? null),
    [rows, selected],
  );

  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        document.querySelector<HTMLElement>(".ticker-table")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const onTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rows.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();

      const currentIndex = selected === null ? -1 : rows.findIndex((r) => r.ticker === selected);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      let next = currentIndex + delta;
      if (currentIndex === -1) next = 0;
      if (next < 0) next = 0;
      if (next > rows.length - 1) next = rows.length - 1;

      const row = rows[next];
      if (row) setSelected(row.ticker);
    },
    [rows, selected],
  );

  if (status === "loading") return <LoadingState />;
  if (status === "error" && error !== null) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }
  if (flow === null) return <ErrorState message="No flow data." />;

  return (
    <div className="flow-layout">
      <main className="table-area">
        <div className="page-toolbar">
          {range !== null && <DatePicker value={range} onChange={onRangeChange} label="Flow window" />}
          <span className="page-toolbar-spacer" />
          <span className="page-toolbar-note" role="status">
            {refreshing
              ? "Loading that window…"
              : notice !== null
                ? `${notice} Showing ${flow.date_from} → ${flow.date_to}.`
                : outsideSnapshot
                  ? `Snapshot covers ${flow.date_from} only — the picked range is outside it.`
                  : `Snapshot covers ${flow.date_from} → ${flow.date_to}.${
                      noFlowRecorded ? " No smart or bad money was recorded in it — prices only." : ""
                    }`}
          </span>
        </div>
        <StatStrip totals={flow.totals} />
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            tabIndex={0}
            role="grid"
            aria-label="Ticker flow table"
            onKeyDown={onTableKeyDown}
          >
            <TickerTable
              rows={rows}
              sort={sort}
              onSortChange={setSort}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        )}
      </main>

      {selectedRow && (
        <DetailPanel
          row={selectedRow}
          tape={tape}
          onClose={() => setSelected(null)}
          structureKeys={structureKeys}
          onStructureChange={setStructureKeys}
        />
      )}
    </div>
  );
}

/* ── Shell ───────────────────────────────────────────────────────────── */

export default function App({
  fetchFlow = defaultFetchFlow,
  fetchTransactions = defaultFetchTransactions,
  initialAuthed,
}: AppProps = {}) {
  const { page, navigate } = useRoute();
  const [density, setDensity] = useState<Density>(readDensity);
  const [authed, setAuthed] = useState<boolean>(
    () => initialAuthed ?? readAuthed(),
  );

  // One shared read of the flow snapshot, so the Sector page's expanded member
  // table can show per-ticker detail without a second fetch.
  const [flowRows, setFlowRows] = useState<readonly TickerRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchFlow().then((res) => {
      if (!cancelled && res.status === "ready" && res.data !== null) {
        setFlowRows(res.data.tickers);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchFlow]);

  useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      /* storage unavailable — density simply does not persist */
    }
  }, [density]);

  const signIn = useCallback(() => {
    try {
      sessionStorage.setItem(AUTH_KEY, "1");
    } catch {
      /* ignore */
    }
    setAuthed(true);
  }, []);

  if (!authed) {
    return (
      <div className="app">
        <LoginPage onSignedIn={signIn} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">ZENITH TERMINAL</div>
          <Nav current={page} onNavigate={navigate} />
        </div>
        <div className="topbar-meta">
          <span className="topbar-page">{page.subtitle}</span>
          <div className="density-toggle" role="group" aria-label="Row density">
            <button
              type="button"
              className={`btn ${density === "compact" ? "btn-active" : ""}`}
              onClick={() => setDensity("compact")}
              aria-pressed={density === "compact"}
            >
              COMPACT
            </button>
            <button
              type="button"
              className={`btn ${density === "comfortable" ? "btn-active" : ""}`}
              onClick={() => setDensity("comfortable")}
              aria-pressed={density === "comfortable"}
            >
              COMFORT
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        <div className="page">
          {page.key === "hub" && (
            <HubPage onNavigate={(h) => navigate((h.replace(/^#\//, "") as typeof page.key))} />
          )}
          {page.key === "flow" && (
            <FlowPage fetchFlow={fetchFlow} fetchTransactions={fetchTransactions} />
          )}
          {page.key === "stock" && <StockRoute />}
          {page.key === "sector" && <SectorPage flowRows={flowRows} />}
          {page.key === "bsjp" && <BsjpPage />}
          {page.key === "portfolio" && <PortfolioPage />}
          {page.key === "admin" && <AdminPage />}
        </div>
      </div>
    </div>
  );
}

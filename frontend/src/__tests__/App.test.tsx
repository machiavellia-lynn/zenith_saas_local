import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import App from "../App";
import type { FlowResponse, TickerRow, TransactionsResponse } from "../types";

/**
 * App-level behaviour: the states, the default ordering, sorting, selection,
 * and the escape/arrow-key interactions. PRD US-009, US-010, US-011, US-014, US-015.
 */

const EMPTY_FLOW: FlowResponse = {
  tickers: [],
  totals: {
    sm: 0,
    bm: 0,
    mf_plus: null,
    mf_minus: null,
    net_cm: 0,
    net_mf: null,
    count: 0,
  },
  date_from: "01-01-2026",
  date_to: "01-01-2026",
};

/** Minimal row builder; only the fields under test carry real values. */
function mkRow(ticker: string, over: Partial<TickerRow> = {}): TickerRow {
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

/** A populated flow, so the table tests have rows to exercise. */
const FLOW: FlowResponse = {
  tickers: [
    mkRow("BBCA", { clean_money: 900, sm_val: 1000, bm_val: 100, rsm: 90, sri: 3, tx: 500, price: 9875, gain_pct: 1.8, phase: "SOS", action: "BUY" }),
    mkRow("BBRI", { clean_money: 700, sm_val: 800, bm_val: 100, rsm: 88, sri: 2.5, tx: 400, price: 4520, gain_pct: 2.3, phase: "ACCUM", action: "BUY" }),
    mkRow("TLKM", { clean_money: 500, sm_val: 600, bm_val: 100, rsm: 85, sri: 2, tx: 300, price: 3140, gain_pct: 0.6, phase: "ABSORB", action: "HOLD" }),
    mkRow("MDKA", { clean_money: -400, sm_val: 100, bm_val: 500, rsm: 16, sri: 0.4, tx: 200, price: 2150, gain_pct: -3.4, phase: "DISTRI", action: "SELL" }),
    mkRow("PTBA", { clean_money: -600, sm_val: 100, bm_val: 700, rsm: 12, sri: 0.3, tx: 150, price: 2680, gain_pct: -2.2, phase: "UPTHRUST", action: "SELL" }),
  ],
  totals: { sm: 2600, bm: 1500, mf_plus: 50, mf_minus: 20, net_cm: 1100, net_mf: 30, count: 5 },
  date_from: "02-10-2026",
  date_to: "02-10-2026",
};

const emptyTape = (ticker: string): TransactionsResponse => ({
  ticker,
  sm: [],
  bm: [],
  sm_count: 0,
  bm_count: 0,
});

/**
 * Render the app already past the login gate, on the Flow page, with rows.
 *
 * The app now opens on the Hub and gates everything behind the demo login, so
 * a table test has to sign in and navigate first. `initialAuthed` skips the
 * gate without touching sessionStorage.
 */
function renderFlow(props: Partial<React.ComponentProps<typeof App>> = {}) {
  window.location.hash = "#/flow";
  return render(
    <App
      initialAuthed
      fetchFlow={async () => ({ status: "ready", data: FLOW, error: null })}
      fetchTransactions={async (t) => ({ status: "ready", data: emptyTape(t), error: null })}
      {...props}
    />,
  );
}

/** An empty dataset, so the empty state is reachable deterministically. */
function renderEmpty() {
  return renderFlow({
    fetchFlow: async () => ({ status: "ready", data: EMPTY_FLOW, error: null }),
  });
}

/** Inject a failure so the error state is reachable deterministically. */
function renderError() {
  return renderFlow({
    fetchFlow: async () => ({ status: "error", data: null, error: "boom" }),
  });
}

function firstBodyRowTicker(): string {
  const rows = screen.getAllByRole("row");
  // rows[0] is the header row
  const firstCell = within(rows[1]!).getAllByRole("cell")[0];
  return firstCell?.textContent ?? "";
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-density");
  });

  it("renders the stat strip and the ticker table once loaded", async () => {
    renderFlow();

    const strip = await screen.findByRole("region", { name: /market flow totals/i });
    expect(strip).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: /ticker flow table/i })).toBeInTheDocument();

    // "NET CM" appears in both the strip and the table header, so scope the query.
    expect(within(strip).getByText("NET CM")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /NET CM/i }),
    ).toBeInTheDocument();
  });

  it("labels the direction indicator on the default sort column", async () => {
    renderFlow();
    await screen.findByRole("grid", { name: /ticker flow table/i });

    const header = screen.getByRole("columnheader", { name: /NET CM/i });
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts by clean money descending by default", async () => {
    renderFlow();
    await screen.findByRole("grid", { name: /ticker flow table/i });

    const rows = screen.getAllByRole("row").slice(1);
    const values = rows
      .map((r) => within(r).getAllByRole("cell")[5]?.textContent ?? "")
      .filter((t) => t !== "â€”");

    // Parse "1.2M" / "-845.3" style back to a comparable magnitude.
    const parsed = values.map((t) => {
      const m = /^(-?[\d.]+)([MBT]?)$/.exec(t.trim());
      if (!m) return Number.NaN;
      const n = Number(m[1]);
      const mult = m[2] === "M" ? 1_000 : m[2] === "B" ? 1_000_000 : m[2] === "T" ? 1e9 : 1;
      return n * mult;
    });

    const sortedDesc = [...parsed].sort((a, b) => b - a);
    expect(parsed).toEqual(sortedDesc);
  });

  it("toggles sort direction when the same header is clicked twice", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("grid", { name: /ticker flow table/i });

    const header = screen.getByRole("columnheader", { name: /RSM/i });
    await user.click(header);
    expect(header).toHaveAttribute("aria-sort", "descending");
    await user.click(header);
    expect(header).toHaveAttribute("aria-sort", "ascending");
  });

  it("opens the detail panel on row click and closes it on Escape", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("grid", { name: /ticker flow table/i });

    const rows = screen.getAllByRole("row").slice(1);
    const ticker = within(rows[0]!).getAllByRole("cell")[0]?.textContent ?? "";
    await user.click(rows[0]!);

    expect(
      await screen.findByRole("complementary", { name: new RegExp(`${ticker} details`, "i") }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("moves the selection with arrow keys", async () => {
    const user = userEvent.setup();
    renderFlow();
    const grid = await screen.findByRole("grid", { name: /ticker flow table/i });

    const before = firstBodyRowTicker();
    grid.focus();
    await user.keyboard("{ArrowDown}");
    const after = firstBodyRowTicker();

    // The first row is selected, so the panel appears for it.
    expect(before).not.toBe("");
    expect(after).not.toBe("");
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("switches density and persists it", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("grid", { name: /ticker flow table/i });

    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    await user.click(screen.getByRole("button", { name: /comfort/i }));
    expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
    expect(localStorage.getItem("zenith-density")).toBe("comfortable");
  });

  it("renders the empty state without crashing when there are no tickers", async () => {
    renderEmpty();
    expect(await screen.findByText(/no tickers to display/i)).toBeInTheDocument();
    // The stat strip must still render rather than collapsing.
    expect(screen.getByRole("region", { name: /market flow totals/i })).toBeInTheDocument();
  });

  it("renders the error state with a retry control", async () => {
    renderError();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("does not render a table when the dataset is empty", async () => {
    renderEmpty();
    await screen.findByText(/no tickers to display/i);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  /* ── Flow window ───────────────────────────────────────────────────── */

  it("renders the range picker seeded from the payload's own dates", async () => {
    renderFlow();
    await screen.findByRole("grid", { name: /ticker flow table/i });

    // FLOW reports 02-10-2026 for both ends, so the picker shows that one day.
    expect(screen.getByRole("button", { name: "Flow window: 2 Oct 26" })).toBeInTheDocument();
  });

  it("keeps the snapshot on screen and says so when the range misses it", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("grid", { name: /ticker flow table/i });

    // A flow row carries no date, so the range cannot filter the table; the
    // toolbar has to admit that the picked window is outside the snapshot.
    // Stepping back once moves the only day to 01-10-2026.
    await user.click(screen.getByRole("button", { name: /previous day/i }));

    expect(
      await screen.findByText(/snapshot covers 02-10-2026 only/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/picked range is outside it/i)).toBeInTheDocument();
    // The table is still there, with every row.
    expect(screen.getByRole("grid", { name: /ticker flow table/i })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(FLOW.tickers.length + 1);
  });

  it("confirms the snapshot window when the range covers it", async () => {
    renderFlow();
    await screen.findByRole("grid", { name: /ticker flow table/i });

    expect(screen.getByText(/snapshot covers 02-10-2026 → 02-10-2026/i)).toBeInTheDocument();
    expect(screen.queryByText(/picked range is outside it/i)).not.toBeInTheDocument();
  });
});

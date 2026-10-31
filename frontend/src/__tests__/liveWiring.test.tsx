import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { type AppProps } from "../App";
import StockRoute from "../pages/StockRoute";
import { assembleStock, type StockData } from "../data/stock";
import type { DataResult, DateWindow } from "../data/http";
import type { FlowResponse, TickerRow, TransactionsResponse } from "../types";
import type { Candle } from "../types.stock";

/**
 * The pages talking to a live backend: the picked window is a real query, a
 * failure leaves the previous figures up, and the Stock page keeps its controls
 * across reloads. `VITE_API_BASE` is stubbed so `isMockMode()` is false; the
 * data functions themselves are injected, so no network is involved.
 */

function mkRow(ticker: string, over: Partial<TickerRow> = {}): TickerRow {
  return {
    ticker,
    clean_money: 0,
    sm_val: 0,
    bm_val: 0,
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

function flowFor(day: string, tickers: string[]): FlowResponse {
  return {
    tickers: tickers.map((t, i) => mkRow(t, { clean_money: 1000 - i * 100, sm_val: 1100, bm_val: 100 })),
    totals: { sm: 100, bm: 50, mf_plus: null, mf_minus: null, net_cm: 50, net_mf: null, count: tickers.length },
    date_from: day,
    date_to: day,
  };
}

const tape = (ticker: string): TransactionsResponse => ({ ticker, sm: [], bm: [], sm_count: 0, bm_count: 0 });
const ok = <T,>(data: T): DataResult<T> => ({ status: "ready", data, error: null });

function renderFlow(fetchFlow: AppProps["fetchFlow"], fetchTransactions?: AppProps["fetchTransactions"]) {
  window.location.hash = "#/flow";
  return render(
    <App
      initialAuthed
      fetchFlow={fetchFlow}
      fetchTransactions={fetchTransactions ?? (async (t) => ok(tape(t)))}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Flow window, live", () => {
  it("re-queries the picked day instead of keeping the old snapshot", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const fetchFlow = vi.fn(async (w?: DateWindow) =>
      ok(flowFor(w === undefined ? "30-10-2026" : w.from, ["BBCA", "BBRI"])),
    );
    const user = userEvent.setup();
    renderFlow(fetchFlow);

    await screen.findByText(/Snapshot covers 30-10-2026/);
    // The first read names no window: the data layer resolves the newest day.
    expect(fetchFlow.mock.calls[0]?.[0]).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Previous day" }));

    await screen.findByText(/Snapshot covers 29-10-2026/);
    expect(fetchFlow).toHaveBeenCalledWith({ from: "29-10-2026", to: "29-10-2026" });
  });

  it("keeps the table and says why when the window cannot load", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const fetchFlow = vi.fn(async (w?: DateWindow): Promise<DataResult<FlowResponse>> =>
      w === undefined
        ? ok(flowFor("30-10-2026", ["BBCA", "BBRI"]))
        : { status: "error", data: null, error: "Request failed: 500 INTERNAL SERVER ERROR" },
    );
    const user = userEvent.setup();
    renderFlow(fetchFlow);
    await screen.findByText("BBCA");

    await user.click(screen.getByRole("button", { name: "Previous day" }));

    await screen.findByText(/Request failed: 500/);
    expect(screen.getByText(/Showing 30-10-2026/)).toBeInTheDocument();
    // The previous window is still on screen.
    expect(screen.getByText("BBCA")).toBeInTheDocument();
    expect(screen.getByText("BBRI")).toBeInTheDocument();
  });

  it("says so when the window holds no smart or bad money, rather than leaving bare zeros", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const bare: FlowResponse = {
      ...flowFor("28-10-2026", ["BBCA", "BBRI"]),
      totals: { sm: 0, bm: 0, mf_plus: null, mf_minus: null, net_cm: 0, net_mf: null, count: 2 },
    };
    renderFlow(async () => ok(bare));

    await screen.findByText(/No smart or bad money was recorded in it/);
  });

  it("stays quiet about that when there is flow", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    renderFlow(async () => ok(flowFor("30-10-2026", ["BBCA"])));

    await screen.findByText(/Snapshot covers 30-10-2026/);
    expect(screen.queryByText(/No smart or bad money was recorded/)).not.toBeInTheDocument();
  });

  it("loads the tape for the window the table covers", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const fetchTransactions = vi.fn(async (t: string) => ok(tape(t)));
    const user = userEvent.setup();
    renderFlow(async () => ok(flowFor("30-10-2026", ["BBCA"])), fetchTransactions);

    await user.click(await screen.findByText("BBCA"));

    await waitFor(() => expect(fetchTransactions).toHaveBeenCalled());
    expect(fetchTransactions).toHaveBeenCalledWith("BBCA", { from: "30-10-2026", to: "30-10-2026" });
  });
});

describe("Flow window, offline (mock)", () => {
  it("does not re-query: the mock cannot answer a window", async () => {
    const fetchFlow = vi.fn(async (_w?: DateWindow) => ok(flowFor("30-10-2026", ["BBCA"])));
    const user = userEvent.setup();
    renderFlow(fetchFlow);
    await screen.findByText(/Snapshot covers 30-10-2026/);
    const before = fetchFlow.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Previous day" }));

    // The note explains the mismatch, as before — and nothing was re-queried.
    await screen.findByText(/the picked range is outside it/);
    expect(fetchFlow.mock.calls.length).toBe(before);
    expect(fetchFlow.mock.calls.every((c) => c[0] === undefined)).toBe(true);
  });
});

/* ── Stock ──────────────────────────────────────────────────────────── */

const candle = (date: string, close: number): Candle => ({
  date,
  open: close - 10,
  high: close + 20,
  low: close - 30,
  close,
  volume: 1_000_000,
});

function stockData(ticker: string, name: string): StockData {
  return assembleStock(
    ticker,
    name,
    [candle("2026-10-29", 5000), candle("2026-10-30", 4980)],
    flowFor("30-10-2026", [ticker]),
    { from: "30-10-2026", to: "30-10-2026" },
  );
}

describe("StockRoute", () => {
  it("renders the offline mock directly, without a loader", () => {
    const fetchStock = vi.fn();
    render(<StockRoute fetchStock={fetchStock} />);
    expect(fetchStock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("loads the default symbol and says which blocks the backend cannot feed", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const fetchStock = vi.fn(async (t: string, _w?: DateWindow) =>
      ok(stockData(t, "PT Bank Central Asia Tbk")),
    );
    render(<StockRoute fetchStock={fetchStock} />);

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("BBCA");
    expect(fetchStock.mock.calls[0]?.[0]).toBe("BBCA");
    expect(fetchStock.mock.calls[0]?.[1]).toBeUndefined();
    expect(screen.getByText("PT Bank Central Asia Tbk")).toBeInTheDocument();
    expect(screen.getByText(/Trade book is not available/)).toBeInTheDocument();
    expect(screen.getByText(/Broker summary is not available/)).toBeInTheDocument();
  });

  it("writes a large clean-money figure in compact units, like the panel beside it", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    // The page opens on its default symbol, so that is the row the figure comes from.
    const flow = flowFor("30-10-2026", ["BBCA"]);
    flow.tickers[0] = mkRow("BBCA", { sm_val: 51_700, bm_val: 62_700, clean_money: -10_973.9, tx: 9 });
    const fetchStock = vi.fn(async (t: string, _w?: DateWindow) =>
      ok(
        assembleStock(
          t,
          "PT Bank Central Asia Tbk",
          [candle("2026-10-29", 23), candle("2026-10-30", 24)],
          flow,
          { from: "30-10-2026", to: "30-10-2026" },
        ),
      ),
    );
    render(<StockRoute fetchStock={fetchStock} />);

    await screen.findByRole("heading", { level: 1 });
    const finding = document.querySelector(".stock-finding")?.textContent ?? "";
    expect(finding).toContain("-11.0 B");
    expect(finding).not.toContain("10973.9");
  });

  it("charts the last 100 daily candles up to the window's end, not just the window", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    // 130 consecutive days ending 2026-10-30.
    const end = Date.UTC(2026, 9, 30);
    const series = Array.from({ length: 130 }, (_, i) =>
      candle(new Date(end - (129 - i) * 86_400_000).toISOString().slice(0, 10), 1000 + i),
    );
    const fetchStock = vi.fn(async (t: string, _w?: DateWindow) =>
      ok(assembleStock(t, "PT Bank Central Asia Tbk", series, flowFor("30-10-2026", [t]), {
        from: "30-10-2026",
        to: "30-10-2026",
      })),
    );
    render(<StockRoute fetchStock={fetchStock} />);

    const chart = await screen.findByLabelText("Candlestick chart, 100 sessions");
    expect(chart).toBeInTheDocument();
    // The axis ends on the session itself and starts 99 sessions earlier.
    expect(chart.textContent).toContain("2026-10-30");
    expect(chart.textContent).toContain(series[30]?.date ?? "missing");
    expect(chart.textContent).not.toContain(series[29]?.date ?? "missing");
  });

  it("loads the typed symbol for the picked window and keeps the page mounted", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const fetchStock = vi.fn(async (t: string) => ok(stockData(t, `${t} Tbk`)));
    const user = userEvent.setup();
    render(<StockRoute fetchStock={fetchStock} />);
    await screen.findByRole("heading", { level: 1 });

    const box = screen.getByLabelText("TICKER");
    await user.clear(box);
    await user.type(box, "goto");
    await user.click(screen.getByRole("button", { name: "LOAD" }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("GOTO"));
    expect(fetchStock).toHaveBeenLastCalledWith("GOTO", { from: "30-10-2026", to: "30-10-2026" });
  });

  it("keeps the previous symbol on screen and explains a failed load", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const fetchStock = vi.fn(async (t: string): Promise<DataResult<StockData>> =>
      t === "BBCA"
        ? ok(stockData("BBCA", "PT Bank Central Asia Tbk"))
        : { status: "error", data: null, error: "Request failed: 404 NOT FOUND" },
    );
    const user = userEvent.setup();
    render(<StockRoute fetchStock={fetchStock} />);
    await screen.findByRole("heading", { level: 1 });

    const box = screen.getByLabelText("TICKER");
    await user.clear(box);
    await user.type(box, "zzzz");
    await user.click(screen.getByRole("button", { name: "LOAD" }));

    await screen.findByText("ZZZZ was not found.");
    // The header still names the symbol whose figures are shown.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("BBCA");
    expect(screen.getByLabelText("TICKER")).toBeInTheDocument();
  });

  it("shows a retryable error when the very first load fails", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const fetchStock = vi.fn(async (): Promise<DataResult<StockData>> => ({
      status: "error",
      data: null,
      error: "Failed to fetch",
    }));
    render(<StockRoute fetchStock={fetchStock} />);

    await screen.findByText(/Could not load BBCA — Failed to fetch/);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

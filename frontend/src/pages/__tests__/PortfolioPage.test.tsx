import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortfolioPage from "../PortfolioPage";
import type {
  EquityPoint,
  PortfolioResponse,
  PortfolioSummary,
  PortfolioTrade,
} from "../../types.pages";
import type { DataResult } from "../../data/pages";

/**
 * PortfolioPage behaviour: the summary strip, the equity chart, the trade
 * filter, the open-trade em dashes and the win/loss bar. Fixtures are inline on
 * purpose — the suite never touches src/data/mockPortfolio.ts.
 */

const EQUITY: EquityPoint[] = [
  { date: "02-01-2026", equity: 1_000_000_000, drawdown_pct: 0 },
  { date: "05-01-2026", equity: 1_012_000_000, drawdown_pct: 0 },
  { date: "06-01-2026", equity: 995_000_000, drawdown_pct: -1.68 },
  { date: "07-01-2026", equity: 1_048_000_000, drawdown_pct: 0 },
];

const SUMMARY: PortfolioSummary = {
  starting_capital: 1_000_000_000,
  equity: 1_048_000_000,
  total_pnl: 48_000_000,
  total_pnl_pct: 4.8,
  win_rate: 66.7,
  trades: 3,
  wins: 2,
  losses: 1,
  max_drawdown_pct: 1.68,
  avg_win_pct: 2.5,
  avg_loss_pct: -1.1,
  profit_factor: 2.4,
  expectancy_pct: 1.3,
};

const TRADES: PortfolioTrade[] = [
  {
    id: 1,
    ticker: "BBCA",
    setup: "SMA5_BREAKOUT_V13",
    entry_date: "02-01-2026",
    exit_date: "05-01-2026",
    entry: 9200,
    exit: 9480,
    lots: 108,
    pnl: 30_240_000,
    pnl_pct: 3.04,
    status: "CLOSED",
    phase: "SOS",
  },
  {
    id: 2,
    ticker: "TLKM",
    setup: "POWER_BREAK_V21",
    entry_date: "06-01-2026",
    exit_date: "07-01-2026",
    entry: 3100,
    exit: 3050,
    lots: 322,
    pnl: -16_100_000,
    pnl_pct: -1.61,
    status: "CLOSED",
    phase: "UPTHRUST",
  },
  {
    id: 3,
    ticker: "ASII",
    setup: "SMA5_BREAKOUT_V13",
    entry_date: "07-01-2026",
    exit_date: null,
    entry: 5000,
    exit: null,
    lots: 200,
    pnl: null,
    pnl_pct: null,
    status: "OPEN",
    phase: null,
  },
];

const RESPONSE: PortfolioResponse = {
  summary: SUMMARY,
  equity_curve: EQUITY,
  trades: TRADES,
  date_from: "02-01-2026",
  date_to: "07-01-2026",
};

const ready = (data: PortfolioResponse): DataResult<PortfolioResponse> => ({
  status: "ready",
  data,
  error: null,
});

function alwaysPortfolio(data: PortfolioResponse = RESPONSE) {
  return vi.fn(async (): Promise<DataResult<PortfolioResponse>> => ready(data));
}

/** A response whose slice has no trades at all. */
function emptyPortfolio(): PortfolioResponse {
  return {
    summary: { ...SUMMARY, trades: 0, wins: 0, losses: 0, equity: 1_000_000_000, total_pnl: 0 },
    equity_curve: EQUITY,
    trades: [],
    date_from: "02-01-2026",
    date_to: "07-01-2026",
  };
}

/**
 * A Wyckoff book that reports an error, so the comparison degrades cleanly
 * instead of silently falling back to the real mock dataset.
 */
function noWyckoff(
  message = "no wyckoff book",
): () => Promise<DataResult<PortfolioResponse>> {
  return vi.fn(async (): Promise<DataResult<PortfolioResponse>> => ({
    status: "error",
    data: null,
    error: message,
  }));
}

/** The em dash, spelled as an escape so the fixture stays greppable. */
const DASH = "\u2014";

/** U+2212 MINUS SIGN, the one formatPnl uses for negative rupees. */
const MINUS = "\u2212";

/** Body rows only, in render order — the header row has no cells. */
function bodyRows(): HTMLElement[] {
  const table = screen.getByRole("table", { name: /trade/i });
  return within(table)
    .getAllByRole("row")
    .filter((r) => within(r).queryAllByRole("cell").length > 0);
}

function tickers(): string[] {
  return bodyRows().map((r) => within(r).getAllByRole("cell")[0]?.textContent ?? "");
}

function rowFor(ticker: string): HTMLElement {
  const row = bodyRows().find((r) => within(r).getAllByRole("cell")[0]?.textContent === ticker);
  if (!row) throw new Error(`${ticker} is not rendered`);
  return row;
}

describe("PortfolioPage", () => {
  it("shows the loading state before the fetch resolves", () => {
    const fetchPortfolio = vi.fn(
      (): Promise<DataResult<PortfolioResponse>> =>
        new Promise<DataResult<PortfolioResponse>>(() => {}),
    );

    render(<PortfolioPage fetchPortfolioBSJP={fetchPortfolio} />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the summary strip from the payload summary", async () => {
    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio()} fetchPortfolioWyckoff={noWyckoff()} />);

    const strip = await screen.findByRole("region", { name: /portfolio summary/i });

    expect(within(strip).getByText("EQUITY")).toBeInTheDocument();
    expect(within(strip).getByText("1,048,000,000")).toBeInTheDocument();

    expect(within(strip).getByText("TOTAL P&L")).toBeInTheDocument();
    expect(within(strip).getByText("+48,000,000")).toBeInTheDocument();
    expect(within(strip).getByText("+4.80%")).toBeInTheDocument();

    expect(within(strip).getByText("WIN RATE")).toBeInTheDocument();
    expect(within(strip).getByText("+66.70%")).toBeInTheDocument();
    expect(within(strip).getByText("2 W / 1 L")).toBeInTheDocument();

    expect(within(strip).getByText("TRADES")).toBeInTheDocument();
    expect(within(strip).getByText("MAX DD")).toBeInTheDocument();
    expect(within(strip).getByText("-1.68%")).toBeInTheDocument();
    expect(within(strip).getByText("PROFIT FACTOR")).toBeInTheDocument();
    expect(within(strip).getByText("2.40")).toBeInTheDocument();
  });

  it("renders one merged comparison chart with a shared axis", async () => {
    render(
      <PortfolioPage
        fetchPortfolioBSJP={alwaysPortfolio()}
        fetchPortfolioWyckoff={async () => ready(RESPONSE)}
      />,
    );

    // A single chart, not one per strategy: the comparison only means
    // something on a shared scale.
    const charts = await screen.findAllByRole("img", { name: /equity comparison/i });
    expect(charts).toHaveLength(1);
    expect(charts[0]!.tagName.toLowerCase()).toBe("svg");
    expect(charts[0]!.getAttribute("aria-label")).toMatch(/BSJP/);
    expect(charts[0]!.getAttribute("aria-label")).toMatch(/WYCKOFF/);

    // Two lines drawn on that one chart.
    expect(charts[0]!.querySelectorAll(".mlc-line")).toHaveLength(2);
  });

  it("shows a comparison row per strategy", async () => {
    render(
      <PortfolioPage
        fetchPortfolioBSJP={alwaysPortfolio()}
        fetchPortfolioWyckoff={async () => ready(RESPONSE)}
      />,
    );

    const table = await screen.findByRole("table", { name: /strategy comparison/i });
    expect(within(table).getByText("BSJP")).toBeInTheDocument();
    expect(within(table).getByText("WYCKOFF")).toBeInTheDocument();
  });

  it("renders a trade row per record with entry, exit, lots and P&L", async () => {
    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio()} fetchPortfolioWyckoff={noWyckoff()} />);
    await screen.findByRole("table", { name: /trade/i });

    const closed = within(rowFor("BBCA")).getAllByRole("cell");
    expect(closed[2]).toHaveTextContent("02-01-2026");
    expect(closed[3]).toHaveTextContent("05-01-2026");
    expect(closed[4]).toHaveTextContent("9,200");
    expect(closed[5]).toHaveTextContent("9,480");
    expect(closed[6]).toHaveTextContent("108");
    expect(closed[7]).toHaveTextContent("+30,240,000");
    expect(closed[8]).toHaveTextContent("+3.04%");
    expect(closed[9]).toHaveTextContent("CLOSED");

    const loss = within(rowFor("TLKM")).getAllByRole("cell");
    // Built from an escape so a re-encode of this file cannot corrupt the sign.
    expect(loss[7]).toHaveTextContent(`${MINUS}16,100,000`);
    expect(loss[8]).toHaveTextContent("-1.61%");
  });

  it("colours P&L by sign", async () => {
    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio()} fetchPortfolioWyckoff={noWyckoff()} />);
    await screen.findByRole("table", { name: /trade/i });

    expect(within(rowFor("BBCA")).getAllByRole("cell")[7]).toHaveClass("val-up");
    expect(within(rowFor("TLKM")).getAllByRole("cell")[7]).toHaveClass("val-down");
  });

  it("renders an em dash for an open trade's exit and P&L, with a distinct status chip", async () => {
    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio()} fetchPortfolioWyckoff={noWyckoff()} />);
    await screen.findByRole("table", { name: /trade/i });

    const open = within(rowFor("ASII")).getAllByRole("cell");
    expect(open[3]).toHaveTextContent(DASH); // exit date
    expect(open[4]).toHaveTextContent("5,000"); // entry price is still real
    expect(open[5]).toHaveTextContent(DASH); // exit price
    expect(open[6]).toHaveTextContent("200"); // lots
    expect(open[7]).toHaveTextContent(DASH); // P&L
    expect(open[8]).toHaveTextContent(DASH); // P&L%

    const chip = within(open[9]!).getByText("OPEN");
    expect(chip).toHaveClass("pf-status");
    expect(chip).toHaveClass("pf-open");
    expect(within(rowFor("BBCA")).getAllByRole("cell")[9]!.querySelector(".pf-open")).toBeNull();
  });

  it("filters by OPEN, CLOSED and back to ALL", async () => {
    const user = userEvent.setup();
    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio()} fetchPortfolioWyckoff={noWyckoff()} />);
    await screen.findByRole("table", { name: /trade/i });

    const group = screen.getByRole("group", { name: /trade filter/i });
    const all = within(group).getByRole("button", { name: "ALL" });
    const open = within(group).getByRole("button", { name: "OPEN" });
    const closed = within(group).getByRole("button", { name: "CLOSED" });

    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(tickers()).toEqual(["BBCA", "TLKM", "ASII"]);

    await user.click(open);
    expect(open).toHaveAttribute("aria-pressed", "true");
    expect(tickers()).toEqual(["ASII"]);

    await user.click(closed);
    expect(tickers()).toEqual(["BBCA", "TLKM"]);

    await user.click(all);
    expect(tickers()).toEqual(["BBCA", "TLKM", "ASII"]);
  });

  it("shows a no-match state when a filter empties the table", async () => {
    const user = userEvent.setup();
    const closedOnly: PortfolioResponse = {
      ...RESPONSE,
      trades: TRADES.filter((t) => t.status === "CLOSED"),
    };

    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio(closedOnly)} />);
    await screen.findByRole("table", { name: /trade/i });

    const group = screen.getByRole("group", { name: /trade filter/i });
    await user.click(within(group).getByRole("button", { name: "OPEN" }));

    expect(screen.getByText(/no trades match this filter/i)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /trade/i })).not.toBeInTheDocument();
  });

  it("no longer renders the win/loss bar below the equity curve (revision 3b)", async () => {
    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio()} fetchPortfolioWyckoff={noWyckoff()} />);

    // Wait for the page to be ready before asserting an absence.
    await screen.findByRole("region", { name: /equity curve comparison/i });

    expect(document.querySelector(".win-loss")).toBeNull();
    expect(document.querySelector(".win-loss-bar")).toBeNull();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    // Win rate is still available in the summary strip.
    const strip = screen.getByRole("region", { name: /portfolio summary/i });
    expect(within(strip).getByText("WIN RATE")).toBeInTheDocument();
  });

  it("notes when only one strategy is available", async () => {
    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio()} fetchPortfolioWyckoff={noWyckoff()} />);

    const region = await screen.findByRole("region", {
      name: /equity curve comparison/i,
    });
    // BSJP always renders; Wyckoff's book is absent in this fixture.
    const table = within(region).getByRole("table", { name: /strategy comparison/i });
    expect(within(table).getByText("BSJP")).toBeInTheDocument();
    expect(within(table).queryByText("WYCKOFF")).not.toBeInTheDocument();
    expect(within(region).getByText(/nothing to compare against/i)).toBeInTheDocument();
  });

  it("switches the trades table to the selected strategy", async () => {
    const user = userEvent.setup();
    // A second book whose trade list is one unmistakable ticker.
    const wyckoffBook: PortfolioResponse = {
      summary: { ...SUMMARY, equity: 72_000_000, total_pnl: 22_000_000, trades: 1 },
      equity_curve: EQUITY,
      trades: [{ ...TRADES[0]!, ticker: "WYC1" }],
      date_from: "02-01-2026",
      date_to: "07-01-2026",
    };

    render(
      <PortfolioPage
        fetchPortfolioBSJP={alwaysPortfolio()}
        fetchPortfolioWyckoff={async () => ready(wyckoffBook)}
      />,
    );

    const region = await screen.findByRole("region", {
      name: /equity curve comparison/i,
    });
    // The switch lives in the WYCKOFF row of the comparison table.
    const table = within(region).getByRole("table", { name: /strategy comparison/i });
    const wyckoffRow = within(table).getByText("WYCKOFF").closest("tr")!;
    const wyckoffTab = within(wyckoffRow).getByRole("button");
    await user.click(wyckoffTab);

    expect(wyckoffTab).toHaveAttribute("aria-pressed", "true");
    // The heading renders "TRADES", a separator, and the strategy as separate
    // nodes, so match on text content. The comparison heading above also
    // contains "WYCKOFF", so this requires the TRADES prefix too.
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: (n) => n.startsWith("TRADES") && n.includes("WYCKOFF"),
    });
    expect(heading.textContent).toContain("TRADES");
    expect(screen.getByText("WYC1")).toBeInTheDocument();
  });

  it("shows the error state when the fetch fails", async () => {
    const fetchPortfolio = vi.fn(
      async (): Promise<DataResult<PortfolioResponse>> => ({
        status: "error",
        data: null,
        error: "boom",
      }),
    );

    render(<PortfolioPage fetchPortfolioBSJP={fetchPortfolio} fetchPortfolioWyckoff={noWyckoff()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    expect(screen.queryByRole("table", { name: /trade/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no trades", async () => {
    render(
      <PortfolioPage
        fetchPortfolioBSJP={alwaysPortfolio(emptyPortfolio())}
        fetchPortfolioWyckoff={noWyckoff()}
      />,
    );

    expect(await screen.findByText(/no tickers to display/i)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /trade/i })).not.toBeInTheDocument();
    // The summary and the curve still render rather than collapsing.
    expect(
      screen.getByRole("img", { name: /equity comparison/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /portfolio summary/i })).toBeInTheDocument();
  });

  it("falls back to a notice when the curve is too short to draw", async () => {
    const onePoint: PortfolioResponse = { ...RESPONSE, equity_curve: [EQUITY[0]!] };
    render(
      <PortfolioPage
        fetchPortfolioBSJP={alwaysPortfolio(onePoint)}
        fetchPortfolioWyckoff={noWyckoff()}
      />,
    );

    expect(
      await screen.findByText(/not enough history to draw a comparison/i),
    ).toBeInTheDocument();
  });

  it("renders a null profit factor as an em dash", async () => {
    const noPf: PortfolioResponse = {
      ...RESPONSE,
      summary: { ...SUMMARY, profit_factor: null },
    };
    render(<PortfolioPage fetchPortfolioBSJP={alwaysPortfolio(noPf)} />);

    const strip = await screen.findByRole("region", { name: /portfolio summary/i });
    const card = within(strip).getByText("PROFIT FACTOR").closest(".stat-card");
    expect(card).toHaveTextContent(DASH);
  });
});

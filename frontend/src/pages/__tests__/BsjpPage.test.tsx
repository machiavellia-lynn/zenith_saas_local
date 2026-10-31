import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BsjpPage from "../BsjpPage";
import type { BsjpSetup, BsjpSignal, BsjpSignalsResponse } from "../../types.pages";
import type { DataResult } from "../../data/pages";

/**
 * BsjpPage behaviour: states, the setup filter, the default score ordering,
 * and the reward/risk guard. Fixtures are inline on purpose — the suite never
 * touches src/data/mockBsjp.ts, which is owned elsewhere.
 */

/** Distinct prices per ticker keep every column's assertion unambiguous. */
function signal(over: Partial<BsjpSignal> & Pick<BsjpSignal, "id" | "ticker">): BsjpSignal {
  return {
    date: "27-10-2026",
    setup: "SMA5_BREAKOUT_V13",
    entry: 1000,
    tp1: 1010,
    tp2: 1020,
    sl: 980,
    sl_type: "FIXED_2PCT",
    score: 0.5,
    day_rank: 1,
    lot_size: 100,
    universe: "full",
    computed_at: "27-10-2026 15:48",
    ...over,
  };
}

const SIGNALS: BsjpSignal[] = [
  signal({ id: 1, ticker: "BBCA", score: 0.42, day_rank: 3, lot_size: 50 }),
  // The score here is the highest in the fixture but arrives last, so a
  // descending default cannot be a coincidence of input order.
  signal({
    id: 2,
    ticker: "TLKM",
    setup: "POWER_BREAK_V21",
    score: 0.91,
    day_rank: 1,
    lot_size: 200,
    entry: 3000,
    tp1: 3060,
    tp2: 3180,
    sl: 2900,
  }),
  // Null score: must sort last, never first.
  signal({
    id: 3,
    ticker: "ASII",
    score: null,
    day_rank: 2,
    lot_size: 75,
    setup: "POWER_BREAK_V21",
    entry: 5000,
    tp1: 5010,
    tp2: 5020,
    sl: 4900,
  }),
];

function response(signals: BsjpSignal[] = SIGNALS): BsjpSignalsResponse {
  return { date: "27-10-2026", count: signals.length, signals };
}

const ready = (data: BsjpSignalsResponse): DataResult<BsjpSignalsResponse> => ({
  status: "ready",
  data,
  error: null,
});

function alwaysBsjp(data: BsjpSignalsResponse = response()) {
  return vi.fn(async (): Promise<DataResult<BsjpSignalsResponse>> => ready(data));
}

/** Body rows only, in render order — the header row has no cells. */
function bodyRows(): HTMLElement[] {
  return screen
    .getAllByRole("row")
    .filter((r) => within(r).queryAllByRole("cell").length > 0);
}

/** The tickers currently rendered, in row order. */
function tickers(): string[] {
  return bodyRows().map((r) => within(r).getAllByRole("cell")[1]?.textContent ?? "");
}

/** A row looked up by ticker, so a sort assertion never depends on index math. */
function rowFor(ticker: string): HTMLElement {
  const row = bodyRows().find((r) => within(r).getAllByRole("cell")[1]?.textContent === ticker);
  if (!row) throw new Error(`${ticker} is not rendered`);
  return row;
}

describe("BsjpPage", () => {
  it("shows the loading state before the fetch resolves", () => {
    const fetchBsjp = vi.fn(
      (): Promise<DataResult<BsjpSignalsResponse>> =>
        new Promise<DataResult<BsjpSignalsResponse>>(() => {}),
    );

    render(<BsjpPage fetchBsjp={fetchBsjp} />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the scanner table and the stat strip once loaded", async () => {
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);

    const strip = await screen.findByRole("region", { name: /bsjp summary/i });
    expect(within(strip).getByText("SIGNALS")).toBeInTheDocument();
    expect(within(strip).getByText("3")).toBeInTheDocument(); // signal count
    expect(within(strip).getByText("SETUPS")).toBeInTheDocument();
    expect(within(strip).getByText("2")).toBeInTheDocument(); // SMA5 + POWER
    expect(within(strip).getByText("BEST SCORE")).toBeInTheDocument();
    expect(within(strip).getByText("0.91")).toBeInTheDocument();
    expect(within(strip).getByText("AVG R:R")).toBeInTheDocument();

    expect(screen.getByRole("table")).toBeInTheDocument();
    // The sort indicator is an aria-hidden glyph, so read the headers by their
    // accessible name rather than their text content.
    expect(screen.getAllByRole("columnheader").map((h) => h.getAttribute("aria-label") ?? h.textContent?.replace(/[▲▼]\s*$/, "").trim())).toEqual([
      "RANK",
      "TICKER",
      "SETUP",
      "ENTRY",
      "TP1",
      "TP2",
      "SL",
      "SL TYPE",
      "SCORE",
      "R:R",
      "LOTS",
    ]);
  });

  it("sorts by score descending by default, with null scores last", async () => {
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    expect(screen.getByRole("columnheader", { name: /SCORE/i })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    // 0.91 -> 0.42 -> null.
    expect(tickers()).toEqual(["TLKM", "BBCA", "ASII"]);

    const scores = bodyRows().map((r) => within(r).getAllByRole("cell")[8]?.textContent ?? "");
    expect(scores).toEqual(["0.91", "0.42", "—"]);
  });

  it("reverses the score order when the header is clicked again", async () => {
    const user = userEvent.setup();
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    const header = screen.getByRole("columnheader", { name: /SCORE/i });
    await user.click(header);

    expect(header).toHaveAttribute("aria-sort", "ascending");
    // Ascending still keeps the unknown score at the bottom.
    expect(tickers()).toEqual(["BBCA", "TLKM", "ASII"]);
  });

  it("narrows the visible rows when a setup is chosen", async () => {
    const user = userEvent.setup();
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    const group = screen.getByRole("group", { name: /setup filter/i });
    const all = within(group).getByRole("button", { name: "ALL" });
    const sma5 = within(group).getByRole("button", { name: "SMA5 BRK" });
    const power = within(group).getByRole("button", { name: "POWER BRK" });

    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(tickers()).toHaveLength(3);

    await user.click(sma5);
    expect(sma5).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(tickers()).toEqual(["BBCA"]);

    await user.click(power);
    expect(tickers()).toEqual(["TLKM", "ASII"]);

    await user.click(all);
    expect(tickers()).toHaveLength(3);
  });

  it("labels a setup with its short form and keeps the full name in the title", async () => {
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    const cell = within(rowFor("TLKM")).getAllByRole("cell")[2];
    expect(cell).toHaveTextContent("POWER BRK");
    expect(within(cell!).getByTitle("POWER_BREAK_V21")).toHaveTextContent("POWER BRK");

    const sma = within(rowFor("BBCA")).getAllByRole("cell")[2];
    expect(sma).toHaveTextContent("SMA5 BRK");
    expect(within(sma!).getByTitle("SMA5_BREAKOUT_V13")).toBeInTheDocument();
  });

  it("computes the reward/risk ratio to two decimals", async () => {
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    // TLKM: (3060 − 3000) / (3000 − 2900) = 0.60
    expect(within(rowFor("TLKM")).getAllByRole("cell")[9]).toHaveTextContent("0.60");
    // BBCA: (1010 − 1000) / (1000 − 980) = 0.50
    expect(within(rowFor("BBCA")).getAllByRole("cell")[9]).toHaveTextContent("0.50");
  });

  it("colours TP1/TP2 up, SL down and leaves ENTRY neutral", async () => {
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    const cells = within(rowFor("BBCA")).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("1,000");
    expect(cells[3]).not.toHaveClass("val-up");
    expect(cells[3]).not.toHaveClass("val-down");
    expect(cells[4]).toHaveClass("val-up");
    expect(cells[5]).toHaveClass("val-up");
    expect(cells[6]).toHaveClass("val-down");
  });

  it("shows an em dash and survives a signal with a null tp1 or sl", async () => {
    const broken: BsjpSignal[] = [
      signal({ id: 10, ticker: "NULLS", tp1: null, sl: null, score: 0.7 }),
      // A stop at or above entry has no defined risk: the guard must not
      // divide by zero or print Infinity.
      signal({
        id: 11,
        ticker: "NORISK",
        entry: 1000,
        tp1: 1010,
        sl: 1000,
        score: 0.6,
        day_rank: 2,
      }),
      signal({ id: 12, ticker: "FINE", score: 0.5, day_rank: 3 }),
    ];

    render(<BsjpPage fetchBsjp={alwaysBsjp(response(broken))} />);
    await screen.findByRole("table");

    const nulls = within(rowFor("NULLS")).getAllByRole("cell");
    expect(nulls[4]).toHaveTextContent("—"); // TP1
    expect(nulls[6]).toHaveTextContent("—"); // SL
    expect(nulls[9]).toHaveTextContent("—"); // R:R

    const noRisk = within(rowFor("NORISK")).getAllByRole("cell");
    expect(noRisk[9]).toHaveTextContent("—");

    // The healthy row is unaffected.
    expect(within(rowFor("FINE")).getAllByRole("cell")[9]).toHaveTextContent("0.50");

    // Nothing anywhere leaks a non-finite number.
    expect(screen.queryByText(/Infinity|NaN|undefined/)).not.toBeInTheDocument();
  });

  it("shows the error state when the fetch fails", async () => {
    const fetchBsjp = vi.fn(
      async (): Promise<DataResult<BsjpSignalsResponse>> => ({
        status: "error",
        data: null,
        error: "boom",
      }),
    );

    render(<BsjpPage fetchBsjp={fetchBsjp} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no signals", async () => {
    render(<BsjpPage fetchBsjp={alwaysBsjp(response([]))} />);

    expect(await screen.findByText(/no tickers to display/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // The strip still renders rather than collapsing.
    const strip = screen.getByRole("region", { name: /bsjp summary/i });
    expect(within(strip).getByText("SIGNALS")).toBeInTheDocument();
  });

  it("offers only the setups present in the payload", async () => {
    const onlySma5: BsjpSignal[] = [signal({ id: 20, ticker: "BBCA" })];
    render(<BsjpPage fetchBsjp={alwaysBsjp(response(onlySma5))} />);
    await screen.findByRole("table");

    const group = screen.getByRole("group", { name: /setup filter/i });
    expect(within(group).getByRole("button", { name: "SMA5 BRK" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "POWER BRK" })).not.toBeInTheDocument();
  });

  it("keeps every setup label total over the closed set", async () => {
    // A compile-time guarantee (Record<BsjpSetup, string>) mirrored at runtime:
    // every setup the type allows must have a label the filter can print.
    const setups: BsjpSetup[] = ["SMA5_BREAKOUT_V13", "POWER_BREAK_V21"];
    const rows = setups.map((setup, i) =>
      signal({ id: 30 + i, ticker: `T${i}`, setup, day_rank: i + 1 }),
    );

    render(<BsjpPage fetchBsjp={alwaysBsjp(response(rows))} />);
    await screen.findByRole("table");

    const group = screen.getByRole("group", { name: /setup filter/i });
    expect(within(group).getAllByRole("button")).toHaveLength(3); // ALL + 2
    expect(bodyRows()).toHaveLength(2);
  });

  /**
   * The picker is a snapshot DATE SELECTOR, not a range filter: every signal in
   * one /api/bsjp/signals payload shares `date`, so a picked window that misses
   * the scan is a mismatch to report, never a reason to blank the table.
   */

  /** The toolbar note, which carries the snapshot/range verdict. */
  function toolbarNote(): HTMLElement {
    const note = document.querySelector<HTMLElement>(".page-toolbar-note");
    if (note === null) throw new Error("no .page-toolbar-note rendered");
    return note;
  }

  it("renders the date-range picker with a range label", async () => {
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    // Seeded from the payload's `date` (27-10-2026 → 27 Oct 26), a single day.
    const trigger = screen.getByRole("button", { name: /Scan date: 27 Oct 26/ });
    expect(trigger).toHaveClass("dp-trigger");
    expect(trigger).toHaveTextContent("27 Oct 26");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("shows no warning note when the range contains the snapshot date", async () => {
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    expect(toolbarNote()).toHaveTextContent("Snapshot 27-10-2026");
    expect(toolbarNote()).not.toHaveTextContent(/outside selected range/i);
    expect(tickers()).toEqual(["TLKM", "BBCA", "ASII"]);
  });

  it("notes a range that excludes the snapshot but still renders every row", async () => {
    const user = userEvent.setup();
    render(<BsjpPage fetchBsjp={alwaysBsjp()} />);
    await screen.findByRole("table");

    const before = tickers();
    expect(before).toHaveLength(SIGNALS.length);

    // Step the seeded single day forward: the window becomes 28 Oct, one clear
    // day past the scan, so the verdict is unambiguous rather than a boundary
    // coincidence.
    await user.click(screen.getByRole("button", { name: /Next day/i }));
    expect(screen.getByRole("button", { name: /Scan date: 28 Oct 26/ })).toBeInTheDocument();

    // The note carries both the snapshot date and the mismatch verdict.
    expect(toolbarNote()).toHaveTextContent("Snapshot 27-10-2026");
    expect(toolbarNote()).toHaveTextContent(/outside selected range/i);
    // The scan is still on screen — the note explains, it does not blank.
    expect(tickers()).toEqual(before);
    expect(bodyRows()).toHaveLength(SIGNALS.length);
  });
});

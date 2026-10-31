import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectorPage from "../SectorPage";
import type { SectorResponse, SectorRow } from "../../types.pages";
import type { DataResult } from "../../data/pages";
import type { TickerRow } from "../../types";

/**
 * SectorPage behaviour: states, the default clean-money ordering, header sort
 * toggling, and the member-ticker reveal. Fixtures are inline so the suite
 * never touches src/data/mockSector.ts.
 */

const ROWS: SectorRow[] = [
  {
    name: "Financials",
    sm_val: 900,
    bm_val: 300,
    cm: 600,
    mf_plus: 420,
    mf_minus: 180,
    net_mf: 240,
    gain_pct: 1.25,
    ticker_count: 8,
  },
  {
    name: "Energy",
    sm_val: 500,
    bm_val: 700,
    cm: -200,
    mf_plus: 120,
    mf_minus: 260,
    net_mf: -140,
    gain_pct: -0.75,
    ticker_count: 6,
  },
  {
    name: "Technology",
    sm_val: 300,
    bm_val: 300,
    cm: 120,
    mf_plus: null,
    mf_minus: null,
    net_mf: null,
    gain_pct: null,
    ticker_count: 5,
  },
];

const RESPONSE: SectorResponse = {
  sectors: ROWS,
  date_from: "01-01-2026",
  date_to: "28-01-2026",
};

const ready = (data: SectorResponse): DataResult<SectorResponse> => ({
  status: "ready",
  data,
  error: null,
});

/** The response fixture doubles as the default; override for the empty case. */
function alwaysSector(data: SectorResponse = RESPONSE) {
  return vi.fn(async (): Promise<DataResult<SectorResponse>> => ready(data));
}

/**
 * Body rows only — the header row is excluded by role and the thin SM/BM bar
 * rows are excluded by class, so the result is one entry per sector in the
 * order the table paints them.
 *
 * Sector names are read from `.sector-name` rather than `.textContent` so the
 * disclosure caret in the same cell does not ride along.
 */
function bodyRowNames(): string[] {
  return screen
    .getAllByRole("row")
    .filter((r) => r.classList.contains("sector-row"))
    .map((r) => r.querySelector(".sector-name")?.textContent ?? "");
}

/** The nine data cells of one sector row, in column order. */
function cellsOf(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell");
}

/** Locate a sector's own row by name, whatever order the table is sorted in. */
function sectorRow(name: string): HTMLElement {
  const row = screen
    .getAllByRole("row")
    .find((r) => r.classList.contains("sector-row") && within(r).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no table row for sector ${name}`);
  return row;
}

/** A minimal flow row, so the expanded member table has data to render. */
function mkFlowRow(ticker: string, over: Partial<TickerRow> = {}): TickerRow {
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

describe("SectorPage", () => {
  it("shows the loading state before the fetch resolves", () => {
    const fetchSector = vi.fn(
      (): Promise<DataResult<SectorResponse>> => new Promise<DataResult<SectorResponse>>(() => {}),
    );

    render(<SectorPage fetchSector={fetchSector} />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the table and the totals strip once loaded", async () => {
    render(<SectorPage fetchSector={alwaysSector()} />);

    const strip = await screen.findByRole("region", { name: /sector totals/i });
    expect(within(strip).getByText("NET CM")).toBeInTheDocument();
    expect(within(strip).getByText("520.0")).toBeInTheDocument(); // 600 - 200 + 120
    expect(within(strip).getByText("100.0")).toBeInTheDocument(); // 240 - 140, null skipped
    expect(within(strip).getByText("Financials")).toBeInTheDocument(); // top sector by cm
    expect(within(strip).getByText("3")).toBeInTheDocument(); // sector count

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(9);
  });

  it("sorts by NET CM descending by default", async () => {
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    expect(screen.getByRole("columnheader", { name: /NET CM/i })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    // Column 3 is NET CM: "600.0", "120.0", "-200.0".
    expect(bodyRowNames()).toEqual(["Financials", "Technology", "Energy"]);
  });

  it("toggles the sort direction when a header is clicked", async () => {
    const user = userEvent.setup();
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    const header = screen.getByRole("columnheader", { name: /NET CM/i });
    expect(header).toHaveAttribute("aria-sort", "descending");

    await user.click(header);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(bodyRowNames()).toEqual(["Energy", "Technology", "Financials"]);

    await user.click(header);
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(bodyRowNames()).toEqual(["Financials", "Technology", "Energy"]);
  });

  it("starts a newly clicked column at its natural direction", async () => {
    const user = userEvent.setup();
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("columnheader", { name: /^SECTOR/i }));
    expect(screen.getByRole("columnheader", { name: /^SECTOR/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(bodyRowNames()).toEqual(["Energy", "Financials", "Technology"]);

    await user.click(screen.getByRole("columnheader", { name: /GAIN%/i }));
    expect(screen.getByRole("columnheader", { name: /GAIN%/i })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    // Null gain sorts last in both directions.
    expect(bodyRowNames()).toEqual(["Financials", "Energy", "Technology"]);
  });

  it("reveals a flow-shaped member table when a row is clicked", async () => {
    const user = userEvent.setup();
    // The expanded body reads per-ticker rows from the flow snapshot.
    const flowRows: TickerRow[] = [
      mkFlowRow("BBCA", { clean_money: 900, price: 9875, sm_val: 1000, bm_val: 100, rsm: 90, tx: 500, gain_pct: 1.8 }),
      mkFlowRow("BBRI", { clean_money: 700, price: 4520, sm_val: 800, bm_val: 100, rsm: 88, tx: 400, gain_pct: 2.3 }),
    ];

    render(<SectorPage fetchSector={alwaysSector()} flowRows={flowRows} />);
    await screen.findByRole("table");

    const financials = sectorRow("Financials");
    expect(within(financials).getByText("Financials")).toBeInTheDocument();

    await user.click(financials);

    expect(screen.getByText("BBCA")).toBeInTheDocument();
    expect(screen.getByText("BBRI")).toBeInTheDocument();
    expect(screen.getByText(/8 MEMBERS/i)).toBeInTheDocument();
    expect(financials).toHaveAttribute("aria-expanded", "true");

    // Flow-shaped, minus PHASE and ACTION (revision 2b).
    const memberTable = screen.getByRole("table", { name: /Financials members/i });
    expect(within(memberTable).getByRole("columnheader", { name: "TICKER" })).toBeInTheDocument();
    expect(within(memberTable).getByRole("columnheader", { name: "PRICE" })).toBeInTheDocument();
    expect(within(memberTable).getByRole("columnheader", { name: "RSM" })).toBeInTheDocument();
    expect(
      within(memberTable).queryByRole("columnheader", { name: /PHASE/i }),
    ).not.toBeInTheDocument();
    expect(
      within(memberTable).queryByRole("columnheader", { name: /ACTION/i }),
    ).not.toBeInTheDocument();

    // Clicking again collapses it.
    await user.click(financials);
    expect(screen.queryByText("BBCA")).not.toBeInTheDocument();
    expect(financials).toHaveAttribute("aria-expanded", "false");
  });

  it("draws one inline SM/BM bar per sector, showing both shares", async () => {
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    // The bar lives in the SM cell now, so there is still exactly one per row.
    const bars = screen.getAllByRole("img", { name: /SM .* vs BM/i });
    expect(bars).toHaveLength(ROWS.length);

    // Financials is 900 SM of 1,200 total: 75% green, 25% red.
    const fill = bars[0]!.querySelector<HTMLElement>(".sm-bm-bar-sm");
    const rest = bars[0]!.querySelector<HTMLElement>(".sm-bm-bar-bm");
    expect(fill?.style.width).toBe("75%");
    expect(rest?.style.width).toBe("25%");

    // The bar sits in the same cell as the SM figure and the row stays one line.
    const smCell = document.querySelector<HTMLElement>(".cell-with-bar");
    expect(smCell).not.toBeNull();
    expect(smCell?.closest("td")).toHaveClass("col-sm-cell");
    // The standalone second row is gone.
    expect(document.querySelector(".sector-bar-row")).toBeNull();
  });

  it("colours NET CM and GAIN% by direction", async () => {
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    const cells = cellsOf(sectorRow("Energy"));
    expect(cells[3]).toHaveClass("val-down"); // NET CM -200
    expect(cells[7]).toHaveClass("val-down"); // GAIN% -0.75
  });

  it("shows a null metric as an em dash, never 0", async () => {
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    const cells = cellsOf(sectorRow("Technology"));
    expect(cells[4]).toHaveTextContent("—"); // MF+
    expect(cells[5]).toHaveTextContent("—"); // MF−
    expect(cells[6]).toHaveTextContent("—"); // NET MF
    expect(cells[7]).toHaveTextContent("—"); // GAIN%
  });

  it("shows the error state when the fetch fails", async () => {
    const fetchSector = vi.fn(
      async (): Promise<DataResult<SectorResponse>> => ({
        status: "error",
        data: null,
        error: "boom",
      }),
    );

    render(<SectorPage fetchSector={fetchSector} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no sectors", async () => {
    render(
      <SectorPage
        fetchSector={alwaysSector({ sectors: [], date_from: "01-01-2026", date_to: "01-01-2026" })}
      />,
    );

    expect(await screen.findByText(/no tickers to display/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // The strip still renders rather than collapsing.
    const strip = screen.getByRole("region", { name: /sector totals/i });
    expect(within(strip).getByText("SECTORS")).toBeInTheDocument();
  });

  /**
   * The picker is a snapshot DATE SELECTOR, not a range filter: every row in a
   * /api/sector payload carries the same session date, so a picked window that
   * misses the snapshot is a mismatch to report, never a reason to blank the
   * table. These tests pin that behaviour down.
   */

  /** The toolbar note, which carries the snapshot/range verdict. */
  function toolbarNote(): HTMLElement {
    const note = document.querySelector<HTMLElement>(".page-toolbar-note");
    if (note === null) throw new Error("no .page-toolbar-note rendered");
    return note;
  }

  it("renders the date-range picker with a range label", async () => {
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    // The trigger names the control's purpose and the window, seeded from the
    // payload's own dates (01-01-2026 → 1 Jan 26, 28-01-2026 → 28 Jan 26).
    const trigger = screen.getByRole("button", {
      name: /Sector snapshot date: 1 Jan 26 – 28 Jan 26/,
    });
    expect(trigger).toHaveClass("dp-trigger");
    expect(trigger).toHaveTextContent("1 Jan 26 – 28 Jan 26");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("shows no warning note when the range contains the snapshot date", async () => {
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    // Seeded from date_from (01-01-2026) to date_to (28-01-2026), which covers
    // the snapshot by construction.
    expect(toolbarNote()).toHaveTextContent("Snapshot 28-01-2026");
    expect(toolbarNote()).not.toHaveTextContent(/outside selected range/i);
    expect(bodyRowNames()).toEqual(["Financials", "Technology", "Energy"]);
  });

  it("notes a range that excludes the snapshot but still renders every row", async () => {
    const user = userEvent.setup();
    render(<SectorPage fetchSector={alwaysSector()} />);
    await screen.findByRole("table");

    const before = bodyRowNames();
    expect(before).toHaveLength(ROWS.length);

    // The seeded window (1–28 Jan) contains the snapshot, so narrow it with the
    // 1D preset — which anchors on `to` and collapses to 28 Jan alone — and
    // then step forward one day, putting the snapshot at 28 Jan and the picked
    // window at 29 Jan. Exactly one day clear of it, so the verdict is
    // unambiguous rather than a boundary coincidence.
    await user.click(screen.getByRole("button", { name: /Sector snapshot date/ }));
    const dialog = screen.getByRole("dialog", { name: /Sector snapshot date/i });
    await user.click(within(dialog).getByRole("button", { name: "1D" }));
    await user.click(screen.getByRole("button", { name: /Next day/i }));

    expect(
      screen.getByRole("button", { name: /Sector snapshot date: 29 Jan 26/ }),
    ).toBeInTheDocument();

    // The note carries both the snapshot date and the mismatch verdict.
    expect(toolbarNote()).toHaveTextContent("Snapshot 28-01-2026");
    expect(toolbarNote()).toHaveTextContent(/outside selected range/i);
    // The snapshot is still on screen — the note explains, it does not blank.
    expect(bodyRowNames()).toEqual(before);
  });
});

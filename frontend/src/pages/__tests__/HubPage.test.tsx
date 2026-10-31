import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HubPage from "../HubPage";
import type { FlowResponse, TickerRow } from "../../types";
import type { MarketSnapshot, SectorResponse } from "../../types.pages";

function row(ticker: string, clean: number, rsm: number, phase: TickerRow["phase"]): TickerRow {
  return {
    ticker,
    clean_money: clean,
    sm_val: clean + 100,
    bm_val: 100,
    rsm,
    mf_plus: 10,
    mf_minus: 5,
    net_mf: 5,
    gain_pct: 1.2,
    price: 1000,
    tx: 100,
    phase,
    action: "BUY",
    watch: null,
    sri: 2,
    mes: 1,
    volx_gap: null,
    rpr: 0.3,
    atr_pct: 2,
    sm_sma10: 10,
    bm_sma10: 5,
    vwap_sm: 990,
    vwap_bm: 1010,
    ma5: 1,
    ma13: 1,
    ma34: 1,
    ma200: 1,
    rsi14: 55,
    cm_streak: 3,
    ma_structure: "Bullish",
    narrative: null,
  };
}

const FLOW: FlowResponse = {
  tickers: [
    row("BBCA", 900, 80, "SOS"),
    row("BBRI", 700, 75, "ACCUM"),
    row("TLKM", 500, 70, "ABSORB"),
    row("GOTO", -800, 20, "DISTRI"),
    row("PTBA", -600, 25, "UPTHRUST"),
    row("MDKA", -400, 30, "SPRING"),
    row("ANTM", 100, 60, "NEUTRAL"),
  ],
  totals: { sm: 1000, bm: 400, mf_plus: 50, mf_minus: 20, net_cm: 600, net_mf: 30, count: 7 },
  date_from: "02-10-2026",
  date_to: "02-10-2026",
};

const SNAPSHOT: MarketSnapshot = {
  ihsg: 7421.55,
  ihsg_gain_pct: 0.84,
  as_of: "2026-10-02",
  time: "16:00:00",
  status: "CLOSED",
};

const SECTOR: SectorResponse = {
  sectors: [
    { name: "Financials", sm_val: 900, bm_val: 300, cm: 600, mf_plus: 20, mf_minus: 5, net_mf: 15, gain_pct: 1.1, ticker_count: 8 },
    { name: "Energy", sm_val: 300, bm_val: 700, cm: -400, mf_plus: 5, mf_minus: 20, net_mf: -15, gain_pct: -1.4, ticker_count: 6 },
  ],
  date_from: "02-10-2026",
  date_to: "02-10-2026",
};

function renderHub(onNavigate = vi.fn()) {
  render(
    <HubPage
      fetchSnapshot={async () => ({ status: "ready", data: SNAPSHOT, error: null })}
      fetchFlow={async () => ({ status: "ready", data: FLOW, error: null })}
      fetchSector={async () => ({ status: "ready", data: SECTOR, error: null })}
      onNavigate={onNavigate}
    />,
  );
  return onNavigate;
}

describe("HubPage", () => {
  it("renders the IHSG snapshot and day totals", async () => {
    renderHub();
    expect(await screen.findByText("7,422")).toBeInTheDocument();
    expect(screen.getByText("+0.84%")).toBeInTheDocument();
    expect(screen.getByText("CLOSED")).toBeInTheDocument();
    expect(screen.getByText("NET CLEAN MONEY")).toBeInTheDocument();
  });

  it("lists the biggest accumulators and distributors", async () => {
    renderHub();
    await screen.findByText("Top accumulation");

    const accum = screen.getByText("Top accumulation").closest(".hub-card")!;
    expect(accum.querySelector(".col-ticker")?.textContent).toBe("BBCA");

    const distri = screen.getByText("Top distribution").closest(".hub-card")!;
    expect(distri.querySelector(".col-ticker")?.textContent).toBe("GOTO");
  });

  it("sorts accumulation descending by clean money", async () => {
    renderHub();
    await screen.findByText("Top accumulation");

    const accum = screen.getByText("Top accumulation").closest(".hub-card")!;
    const tickers = [...accum.querySelectorAll(".col-ticker")].map((e) => e.textContent);
    // The card shows the top 6 by clean money, descending.
    expect(tickers).toEqual(["BBCA", "BBRI", "TLKM", "ANTM", "MDKA", "PTBA"]);
  });

  it("shows sector rotation", async () => {
    renderHub();
    await screen.findByText("Sector rotation");
    expect(screen.getByText("Financials")).toBeInTheDocument();
    expect(screen.getByText("Energy")).toBeInTheDocument();
  });

  it("navigates when a shortcut is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = renderHub();
    await screen.findByText("Jump to");

    await user.click(screen.getByRole("button", { name: /BSJP Scanner/i }));
    expect(onNavigate).toHaveBeenCalledWith("#/bsjp");
  });

  it("renders the error state when the snapshot fails", async () => {
    render(
      <HubPage
        fetchSnapshot={async () => ({ status: "error", data: null, error: "boom" })}
        fetchFlow={async () => ({ status: "ready", data: FLOW, error: null })}
        fetchSector={async () => ({ status: "ready", data: SECTOR, error: null })}
      />,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

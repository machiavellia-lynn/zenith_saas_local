import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "../LoginPage";
import AdminPage from "../AdminPage";
import type { AdminResponse } from "../../types.pages";

const ADMIN: AdminResponse = {
  jobs: [
    {
      key: "ingest",
      name: "Daily ingest",
      description: "Parse Telegram alerts into raw tables",
      schedule: "17:30 WIB",
      status: "ok",
      last_run: "02-10-2026 17:31",
      last_result: "1,204 rows",
      rows: 1204,
    },
    {
      key: "bsjp",
      name: "BSJP scan",
      description: "Score and rank setups",
      schedule: "18:00 WIB",
      status: "failed",
      last_run: "02-10-2026 18:00",
      last_result: "timeout",
      rows: null,
    },
    {
      key: "rebuild",
      name: "EOD rebuild",
      description: "Aggregate flow into eod_summary",
      schedule: "18:15 WIB",
      status: "running",
      last_run: "02-10-2026 18:15",
      last_result: null,
      rows: null,
    },
    {
      key: "weekly",
      name: "Weekly correction",
      description: "DataSectors backfill",
      schedule: "Sat 06:00",
      status: "idle",
      last_run: null,
      last_result: null,
      rows: null,
    },
  ],
  counts: { eod_summary: 48_112, raw_messages: 96_204, bsjp_signals: 312, tickers: 812 },
  universe: "full",
  last_ingest: "02-10-2026 17:31",
};

describe("LoginPage", () => {
  it("blocks submit and explains when fields are empty", async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);

    await user.click(screen.getByRole("button", { name: /enter terminal/i }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("signs in with any non-empty credentials", async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText(/email/i), "trader@zenith.local");
    await user.type(screen.getByLabelText(/password/i), "anything");
    await user.click(screen.getByRole("button", { name: /enter terminal/i }));

    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("states plainly that it does not verify credentials", () => {
    render(<LoginPage />);
    expect(screen.getByText(/no backend/i)).toBeInTheDocument();
  });
});

describe("AdminPage", () => {
  it("renders job rows with their status", async () => {
    render(<AdminPage fetchAdmin={async () => ({ status: "ready", data: ADMIN, error: null })} />);

    expect(await screen.findByText("Daily ingest")).toBeInTheDocument();
    expect(screen.getByText("BSJP scan")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows an em dash for a job that has never run", async () => {
    render(<AdminPage fetchAdmin={async () => ({ status: "ready", data: ADMIN, error: null })} />);

    await screen.findByText("Daily ingest");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the error state on failure", async () => {
    render(
      <AdminPage fetchAdmin={async () => ({ status: "error", data: null, error: "boom" })} />,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("renders a date-range picker seeded from the job runs", async () => {
    render(<AdminPage fetchAdmin={async () => ({ status: "ready", data: ADMIN, error: null })} />);
    await screen.findByText("Daily ingest");

    // The newest and oldest last_run in the fixture are both 02-10-2026, so the
    // picker opens as a single day.
    const picker = screen.getByRole("button", { name: /last run window/i });
    expect(picker).toBeInTheDocument();
    expect(picker.textContent).toContain("Oct");
  });

  it("filters the job list to the picked window", async () => {
    const user = userEvent.setup();
    render(<AdminPage fetchAdmin={async () => ({ status: "ready", data: ADMIN, error: null })} />);
    await screen.findByText("Daily ingest");

    // Widen to a one-year span backwards from the newest run, which still
    // covers every job in the fixture.
    await user.click(screen.getByRole("button", { name: /last run window/i }));
    const dialog = await screen.findByRole("dialog", { name: /last run window/i });
    await user.click(within(dialog).getByRole("button", { name: "1Y" }));

    expect(screen.getByText("Daily ingest")).toBeInTheDocument();
    expect(screen.getByText(/jobs shown/i)).toBeInTheDocument();
  });

  it("labels itself read-only", async () => {
    render(<AdminPage fetchAdmin={async () => ({ status: "ready", data: ADMIN, error: null })} />);
    await screen.findByText("Daily ingest");    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });
});

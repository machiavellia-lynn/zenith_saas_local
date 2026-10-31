/**
 * Static mock of the admin/ops surface (`GET /api/admin/status` and friends).
 *
 * Shape comes from `types.pages.ts` (`AdminResponse`), which mirrors the
 * reference's job-status payloads:
 *   D:\zenith_saas\routes\routes_admin.py   (READ-ONLY)
 *   D:\zenith_saas\algo\algo_portfolio.py   L404-409 (universe scoping)
 *
 * Mirrored from that file:
 *  - `universe` is the account's mode, `"full"` for a general account and
 *    `"syariah"` for a sharia one; every job row is scoped by it.
 *  - `counts` are the table row counts the status page reports: EOD summary
 *    rows, raw scraped messages, BSJP signals and the active ticker universe.
 *    The reference reads them from `eod_summary`, `raw_messages`,
 *    `bsjp_signals` and `ticker_universe`.
 *  - `status` mirrors the four states the UI renders: `idle` (scheduled, not
 *    running), `running` (in flight now), `ok` (last run succeeded) and
 *    `failed` (last run errored). Every one of the four appears below so the
 *    status column's styling is exercised in all four branches.
 *  - `last_run` / `last_ingest` are DD-MM-YYYY HH:MM stamps in WIB; `rows` is
 *    the row count the last run touched.
 *
 * Snapshotted mid-ingest on purpose: "Daily ingest" is `running` while every
 * other job shows its settled result, which is the state the ops panel has to
 * render most often and the one easiest to get wrong.
 */

import type { AdminJob, AdminResponse, JobStatus } from "../types.pages";

/** The account's universe; `full` is the general account. */
export const ADMIN_UNIVERSE = "full";

/**
 * The four job states, in the order the panel lists them.
 *
 * Exported so the UI can label and order the status column from one place
 * instead of repeating the string literals.
 */
export const JOB_STATUSES: readonly JobStatus[] = [
  "running",
  "ok",
  "failed",
  "idle",
] as const;

/** One scheduled job as the ops panel shows it. */
interface JobSpec {
  key: string;
  name: string;
  description: string;
  schedule: string;
  status: JobStatus;
  last_run: string | null;
  last_result: string | null;
  rows: number | null;
}

/**
 * The scheduler's job list.
 *
 * Names and cadences are the reference's own: ingest runs through the session,
 * the EOD rebuild and BSJP scan are post-close jobs, and the corrective passes
 * (DataSectors backfill, price history) are the weekly repair jobs an operator
 * reaches for when a day's data is thin.
 */
const JOBS: readonly JobSpec[] = [
  {
    key: "daily_ingest",
    name: "Daily ingest",
    description: "Pull SM/BM and MF messages from the Telegram scraper feeds into raw_messages.",
    schedule: "Every 15 min, 09:00–16:15 WIB",
    status: "running",
    last_run: "02-10-2026 16:00",
    last_result: "Ingesting 41 messages (SM 18 / BM 23)",
    rows: 41_882,
  },
  {
    key: "eod_summary_rebuild",
    name: "EOD summary rebuild",
    description: "Recompute sm_val, bm_val, mf_plus, mf_minus and price_change_pct per ticker.",
    schedule: "Daily 16:30 WIB",
    status: "ok",
    last_run: "02-10-2026 16:30",
    last_result: "Rebuilt 962 tickers over 02-10-2026",
    rows: 962,
  },
  {
    key: "bsjp_scan",
    name: "BSJP scan",
    description: "Score the universe against the enabled setups and write the ranked TOP_N slice.",
    schedule: "Daily 17:05 WIB",
    status: "ok",
    last_run: "02-10-2026 17:05",
    last_result: "14 signals written across 2 setups",
    rows: 14,
  },
  {
    key: "portfolio_recompute",
    name: "Portfolio recompute",
    description: "Re-simulate the BSJP book and rebuild the equity curve and summary stats.",
    schedule: "Daily 17:20 WIB",
    status: "ok",
    last_run: "02-10-2026 17:20",
    last_result: "24 trades, equity Rp 61,840,200",
    rows: 24,
  },
  {
    key: "sector_aggregate",
    name: "Sector aggregate",
    description: "Roll per-ticker flow into the eleven sector rows the rotation table reads.",
    schedule: "Daily 17:35 WIB",
    status: "ok",
    last_run: "02-10-2026 17:35",
    last_result: "11 sectors aggregated over 02-10-2026",
    rows: 11,
  },
  {
    key: "weekly_datasectors_correction",
    name: "Weekly DataSectors correction",
    description: "Re-fetch the week's OHLCV from DataSectors and overwrite rows the vendor revised.",
    schedule: "Sat 08:00 WIB",
    status: "idle",
    last_run: "27-09-2026 08:00",
    last_result: "Corrected 3,418 rows; 202 tickers revised",
    rows: 3_418,
  },
  {
    key: "price_history_backfill",
    name: "Price history backfill",
    description: "Backfill 200 sessions of daily OHLCV for the active universe from Yahoo Finance.",
    schedule: "Sun 06:00 WIB",
    status: "failed",
    last_run: "28-09-2026 06:00",
    last_result: "Yahoo Finance rate limit hit after 612 of 962 tickers — retry scheduled",
    rows: 612,
  },
  {
    key: "wyckoff_recompute",
    name: "Wyckoff recompute",
    description: "Re-run the v3.1 phase classifier and refresh analytics_daily for the date range.",
    schedule: "Daily 18:00 WIB",
    status: "ok",
    last_run: "02-10-2026 18:00",
    last_result: "Phases refreshed for 962 tickers",
    rows: 962,
  },
];

/** The job list, in the order the panel shows it. */
const jobs: AdminJob[] = JOBS.map((j) => ({
  key: j.key,
  name: j.name,
  description: j.description,
  schedule: j.schedule,
  status: j.status,
  last_run: j.last_run,
  last_result: j.last_result,
  rows: j.rows,
}));

// The panel's status column is styled per state; a state with no rows would
// leave one branch unexercised in the mock, so it is asserted at load instead.
const uncovered = JOB_STATUSES.filter((s) => !jobs.some((j) => j.status === s));
if (uncovered.length > 0) {
  throw new Error(`mockAdmin: no job with status ${uncovered.join(", ")}`);
}

/** Mock ops snapshot, shaped like the reference's admin status payload. */
export const mockAdmin: AdminResponse = {
  jobs,
  counts: {
    eod_summary: 268_415,
    raw_messages: 1_842_906,
    bsjp_signals: 14_206,
    tickers: 962,
  },
  universe: ADMIN_UNIVERSE,
  last_ingest: "02-10-2026 16:00",
};

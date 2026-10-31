/**
 * The flow data-access module.
 *
 * Every component reads data through here and never imports a mock file
 * directly. That is what makes swapping to the real Flask API a one-file
 * change (PRD US-016, FR-10).
 *
 * When `VITE_API_BASE` is set, this hits `${base}/api/flow` and
 * `${base}/api/transactions` with the backend's param names. When it is unset
 * (the default), it serves static mocks.
 *
 * With no window given, a live read asks for the newest day the database holds
 * (see `http.ts`) — the backend's own default is "today", which is empty on a
 * weekend.
 *
 * Source of truth for the contract:
 *   backend/routes/routes_flow.py  (/api/flow, /api/transactions)
 */

import type { FlowResponse, TransactionsResponse } from "../types";
import { emptyTransactions } from "../types";
import {
  apiBase,
  isMockMode,
  getJson,
  joinUrl,
  liveOrMock,
  resolveWindow,
  type DataResult,
  type DataStatus,
  type DateWindow,
} from "./http";
import { mockFlow } from "./mockFlow";
import { mockTransactions } from "./mockTransactions";

export { apiBase, isMockMode };
export type { DataResult, DataStatus, DateWindow };

/**
 * Build the /api/flow URL exactly as the backend expects.
 * `date_from` / `date_to` are DD-MM-YYYY.
 */
export function flowUrl(base: string, dateFrom: string, dateTo: string): string {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  return joinUrl(base, `/api/flow?${params.toString()}`);
}

/** Build the /api/transactions URL. The backend uses `ticker`, `date_from`, `date_to`. */
export function transactionsUrl(
  base: string,
  ticker: string,
  dateFrom: string,
  dateTo: string,
): string {
  const params = new URLSearchParams({
    ticker,
    date_from: dateFrom,
    date_to: dateTo,
  });
  return joinUrl(base, `/api/transactions?${params.toString()}`);
}

/**
 * Read the flow snapshot for a window (default: the newest day).
 *
 * In mock mode this resolves the static dataset and ignores the window. Either
 * way the caller gets a `DataResult` it can render without guessing.
 */
export function fetchFlow(window?: DateWindow): Promise<DataResult<FlowResponse>> {
  return liveOrMock(
    async (base) => {
      const w = await resolveWindow(base, window);
      return getJson<FlowResponse>(flowUrl(base, w.from, w.to));
    },
    () => mockFlow,
  );
}

/**
 * Read one ticker's transaction tape for a window (default: the newest day).
 *
 * A ticker with no tape returns an empty tape rather than undefined, so the
 * UI always has a defined shape to render (PRD US-005).
 */
export function fetchTransactions(
  ticker: string,
  window?: DateWindow,
): Promise<DataResult<TransactionsResponse>> {
  return liveOrMock(
    async (base) => {
      const w = await resolveWindow(base, window);
      return getJson<TransactionsResponse>(transactionsUrl(base, ticker, w.from, w.to));
    },
    () => mockTransactions[ticker] ?? emptyTransactions(ticker),
  );
}

/**
 * Shared plumbing for the data modules (`index.ts`, `pages.ts`, `stock.ts`).
 *
 * This is the only place that knows how to reach the backend: the base URL, the
 * JSON read, the error shape, and the one backend quirk every page depends on —
 * the API defaults a missing date to *today*, which on a weekend (or any day the
 * market has not closed) matches no data. Live reads therefore always send an
 * explicit date, resolved from `/api/last-date`.
 */

/** Status of a data read, so the UI can render loading/error/empty states. */
export type DataStatus = "loading" | "ready" | "error";

export interface DataResult<T> {
  status: DataStatus;
  data: T | null;
  error: string | null;
}

/** An inclusive date window in the API's `DD-MM-YYYY` form. */
export interface DateWindow {
  from: string;
  to: string;
}

/** Base URL of the real API, or undefined to use mocks. */
export function apiBase(): string | undefined {
  const base = import.meta.env?.VITE_API_BASE as string | undefined;
  return base && base.length > 0 ? base : undefined;
}

/** True when serving static mocks (no backend configured). */
export function isMockMode(): boolean {
  return apiBase() === undefined;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function readyResult<T>(data: T): DataResult<T> {
  return { status: "ready", data, error: null };
}

export function errorResult<T>(err: unknown): DataResult<T> {
  return {
    status: "error",
    data: null,
    error: err instanceof Error ? err.message : "Unknown error",
  };
}

/**
 * A page the local backend cannot feed. Reported as an error with a plain
 * reason, never as mock data: a mock figure on a live screen reads as real.
 */
export function unavailable<T>(what: string, why: string): DataResult<T> {
  return {
    status: "error",
    data: null,
    error: `${what} is not available from this backend: ${why}`,
  };
}

/** Run a live read, or hand back the mock when no backend is configured. */
export async function liveOrMock<T>(
  live: (base: string) => Promise<T>,
  fallback: () => T,
): Promise<DataResult<T>> {
  const base = apiBase();
  if (base === undefined) return readyResult(fallback());
  try {
    return readyResult(await live(base));
  } catch (err) {
    return errorResult(err);
  }
}

/**
 * `/api/last-date` answers `DD/MM/YYYY` (slashes), or `null` for an empty
 * database. Everything else in the API speaks `DD-MM-YYYY`, so convert here.
 */
export function parseLastDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** The newest date the database holds, as `DD-MM-YYYY`. */
export async function fetchLatestDate(base: string): Promise<string> {
  const body = await getJson<{ date?: unknown }>(joinUrl(base, "/api/last-date"));
  const date = parseLastDate(body.date);
  if (date === null) throw new Error("The database has no flow data yet.");
  return date;
}

/** The caller's window, or — when none was given — the newest day alone. */
export async function resolveWindow(base: string, given?: DateWindow): Promise<DateWindow> {
  if (given !== undefined) return given;
  const day = await fetchLatestDate(base);
  return { from: day, to: day };
}

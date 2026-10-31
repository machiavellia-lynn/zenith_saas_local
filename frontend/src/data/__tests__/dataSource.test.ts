import { describe, it, expect, afterEach, vi } from "vitest";
import {
  apiBase,
  flowUrl,
  isMockMode,
  transactionsUrl,
  fetchFlow,
  fetchTransactions,
} from "../index";
import { emptyTransactions } from "../../types";

/**
 * The swap seam. PRD US-016 / FR-10:
 * exactly one module decides mock vs real, so wiring the Flask API later is a
 * one-file change. The real path is asserted here with a stubbed fetch, even
 * though no backend exists.
 */

describe("mock mode (default)", () => {
  it("reports mock mode when no base URL is configured", () => {
    expect(apiBase()).toBeUndefined();
    expect(isMockMode()).toBe(true);
  });

  it("serves the static dataset without touching fetch", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const res = await fetchFlow();
    expect(res.status).toBe("ready");
    expect(res.data?.tickers.length).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("returns an empty tape, not undefined, for an unknown ticker", async () => {
    const res = await fetchTransactions("ZZZZ_NOT_REAL");
    expect(res.status).toBe("ready");
    expect(res.data).toEqual(emptyTransactions("ZZZZ_NOT_REAL"));
    expect(res.data?.sm).toEqual([]);
    expect(res.data?.bm).toEqual([]);
    expect(res.data?.sm_count).toBe(0);
  });
});

describe("URL construction", () => {
  it("builds the flow URL with the backend's param names", () => {
    const url = flowUrl("http://localhost:5000", "01-01-2026", "02-01-2026");
    expect(url).toBe("http://localhost:5000/api/flow?date_from=01-01-2026&date_to=02-01-2026");
  });

  it("builds the transactions URL with ticker and dates", () => {
    const url = transactionsUrl("http://localhost:5000", "BBCA", "01-01-2026", "02-01-2026");
    expect(url).toContain("/api/transactions?");
    expect(url).toContain("ticker=BBCA");
    expect(url).toContain("date_from=01-01-2026");
    expect(url).toContain("date_to=02-01-2026");
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(flowUrl("http://localhost:5000/", "01-01-2026", "02-01-2026")).toContain(
      "http://localhost:5000/api/flow?",
    );
  });
});

describe("live mode (base URL configured)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const FLOW_PAYLOAD = {
    tickers: [],
    totals: { sm: 0, bm: 0, mf_plus: null, mf_minus: null, net_cm: 0, net_mf: null, count: 0 },
    date_from: "30-10-2026",
    date_to: "30-10-2026",
  };

  /** A fetch stub that answers by path, and records every URL it was asked for. */
  function routedFetch(routes: Record<string, unknown>) {
    return vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (!(path in routes)) {
        return { ok: false, status: 404, statusText: "NOT FOUND", json: async () => ({}) };
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => routes[path] };
    });
  }

  it("asks for the newest day when no window is given, not for 'today'", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const spy = routedFetch({ "/api/last-date": { date: "30/10/2026" }, "/api/flow": FLOW_PAYLOAD });
    vi.stubGlobal("fetch", spy);

    expect(isMockMode()).toBe(false);
    const res = await fetchFlow();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[0]?.[0])).toBe("http://localhost:5000/api/last-date");
    const flowCall = String(spy.mock.calls[1]?.[0]);
    expect(flowCall).toContain("http://localhost:5000/api/flow?");
    // The slash form the API reports is converted to the dashed form it accepts.
    expect(flowCall).toContain("date_from=30-10-2026");
    expect(flowCall).toContain("date_to=30-10-2026");
    expect(res.status).toBe("ready");
    expect(res.data).toEqual(FLOW_PAYLOAD);
  });

  it("uses the given window as is and skips the last-date lookup", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const spy = routedFetch({ "/api/flow": FLOW_PAYLOAD });
    vi.stubGlobal("fetch", spy);

    const res = await fetchFlow({ from: "29-10-2026", to: "30-10-2026" });

    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain("date_from=29-10-2026");
    expect(url).toContain("date_to=30-10-2026");
    expect(res.status).toBe("ready");
  });

  it("reports an empty database instead of querying a made-up date", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const spy = routedFetch({ "/api/last-date": { date: null } });
    vi.stubGlobal("fetch", spy);

    const res = await fetchFlow();

    expect(res.status).toBe("error");
    expect(res.error).toContain("no flow data");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reads the transactions tape for the same window", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    const tape = { ticker: "BBCA", sm: [], bm: [], sm_count: 0, bm_count: 0 };
    const spy = routedFetch({ "/api/transactions": tape });
    vi.stubGlobal("fetch", spy);

    const res = await fetchTransactions("BBCA", { from: "29-10-2026", to: "30-10-2026" });

    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain("ticker=BBCA");
    expect(url).toContain("date_from=29-10-2026");
    expect(url).toContain("date_to=30-10-2026");
    expect(res.data).toEqual(tape);
  });

  it("surfaces a non-ok response as the error state", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: "UNAUTHORIZED",
        json: async () => ({ error: "unauthorized" }),
      })),
    );

    const res = await fetchFlow();
    expect(res.status).toBe("error");
    expect(res.data).toBeNull();
    expect(res.error).toContain("401");
  });

  it("surfaces a thrown network error as the error state", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:5000");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const res = await fetchFlow();
    expect(res.status).toBe("error");
    expect(res.error).toContain("network down");
  });
});

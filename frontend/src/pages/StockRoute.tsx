import { useCallback, useEffect, useRef, useState } from "react";
import StockPage, { type StockQuery } from "./StockPage";
import { ErrorState, LoadingState } from "../components/States";
import { fetchStock as defaultFetchStock, type StockData } from "../data/stock";
import { isMockMode, type DateWindow } from "../data/http";
import { isoToDisplay } from "../lib/date";

interface Props {
  fetchStock?: typeof defaultFetchStock;
}

/** The symbol opened first, before the user has typed one. */
export const DEFAULT_TICKER = "BBCA";

/** `/api/ohlcv` answers 404 for a symbol it does not know. */
export function describeFailure(ticker: string, error: string | null): string {
  if (error !== null && error.includes("404")) return `${ticker} was not found.`;
  return `Could not load ${ticker}${error === null ? "" : ` — ${error}`}`;
}

function toWindow(q: StockQuery): DateWindow {
  return { from: isoToDisplay(q.from), to: isoToDisplay(q.to) };
}

/**
 * Loads the Stock page's data and re-loads it when the ticker or the session
 * window changes. `StockPage` stays mounted across those reloads — it owns the
 * ticker box and the picker, and unmounting it would throw the user's input away
 * — so a reload shows "UPDATING…" and a failure shows a notice, both over the
 * figures that were already on screen.
 *
 * With no backend configured the page renders its mock data directly, exactly
 * as it did before there was a loader.
 */
export default function StockRoute({ fetchStock = defaultFetchStock }: Props) {
  if (isMockMode()) return <StockPage />;
  return <LiveStock fetchStock={fetchStock} />;
}

function LiveStock({ fetchStock }: Required<Props>) {
  const [data, setData] = useState<StockData | null>(null);
  const [firstError, setFirstError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** Which request is current; an older reply must not overwrite a newer one. */
  const seq = useRef(0);
  /** Whether anything has loaded yet, i.e. whether a failure can fall back to it. */
  const loaded = useRef(false);

  const load = useCallback(
    async (symbol: string, window: DateWindow | undefined) => {
      const id = ++seq.current;
      setRefreshing(true);
      setNotice(null);
      const res = await fetchStock(symbol, window);
      if (id !== seq.current) return;
      setRefreshing(false);
      if (res.status === "ready" && res.data !== null) {
        loaded.current = true;
        setData(res.data);
        setFirstError(null);
        return;
      }
      const message = describeFailure(symbol, res.error);
      if (loaded.current) setNotice(message);
      else setFirstError(message);
    },
    [fetchStock],
  );

  useEffect(() => {
    void load(DEFAULT_TICKER, undefined);
  }, [load]);

  const onQueryChange = useCallback(
    (q: StockQuery) => {
      void load(q.ticker, toWindow(q));
    },
    [load],
  );

  if (data === null) {
    if (firstError !== null) {
      return (
        <ErrorState
          message={firstError}
          onRetry={() => void load(DEFAULT_TICKER, undefined)}
        />
      );
    }
    return <LoadingState />;
  }

  return (
    <StockPage
      snapshot={data.snapshot}
      candles={data.candles}
      tradeBook={data.tradeBook}
      smBm={data.smBm}
      brokers={data.brokers}
      missing={data.missing}
      onQueryChange={onQueryChange}
      refreshing={refreshing}
      notice={notice}
    />
  );
}

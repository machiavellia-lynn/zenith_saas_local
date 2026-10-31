"""
bsjp_results.py — writer for the bsjp_results table (had no writer before).

A BSJP signal dated T is entered at the T close and exited on the next trading
day, judged by that day's 15m candles via algo_bsjp.eval_exit_15m. So a result
is always one trading day behind its signal.

Only used when BSJP_CATCHUP=1 — the BSJP algo is disabled in the laptop catch-up
by default.
"""
import logging
from datetime import datetime

from core.db import execute, fetchall

log = logging.getLogger("zenith.ops.bsjp_results")


def _iso(date_dmy: str) -> str:
    return datetime.strptime(date_dmy, "%d-%m-%Y").strftime("%Y-%m-%d")


def evaluate_signals(signals: list, candles_by_ticker: dict, eval_fn) -> list:
    """Pure core. signals: [{ticker, entry, tp1, tp2, sl}]; candles_by_ticker:
    {ticker: [candle dicts oldest-first]}. Returns rows ready for bsjp_results.
    A signal whose ticker has no candles is skipped, not written as a failure —
    "no data" is not a trading loss."""
    out = []
    for s in signals:
        candles = candles_by_ticker.get(s["ticker"])
        if not candles:
            continue
        res = eval_fn(s["entry"], s["tp1"], s["tp2"], s["sl"], candles)
        t = str(res.get("exit_time") or "")
        out.append({
            "ticker":     s["ticker"],
            "exit_price": res.get("exit_price"),
            "status":     res.get("status"),
            "reason":     res.get("reason"),
            "exit_time":  t[-5:] if len(t) >= 5 else None,
            "pnl":        res.get("pnl_pct"),
        })
    return out


def write_results_for_date(conn, date_dmy: str) -> dict:
    """Evaluate and upsert results for signals dated date_dmy. Caller commits.
    Returns {"state": "no_signals" | "no_next_day" | "done", "written": n,
    "skipped_no_candles": n, "next_day": 'YYYY-MM-DD' | None}."""
    from algo.algo_bsjp import eval_exit_15m

    signals = fetchall(conn, """
        SELECT DISTINCT ON (ticker) ticker, entry, tp1, tp2, sl
        FROM bsjp_signals
        WHERE date = %s
        ORDER BY ticker, (universe = 'full') DESC
    """, [date_dmy])
    if not signals:
        return {"state": "no_signals", "written": 0, "skipped_no_candles": 0, "next_day": None}

    row = fetchall(conn, """
        SELECT MIN(LEFT(datetime, 10)) AS d FROM price_history_15m
        WHERE LEFT(datetime, 10) > %s
    """, [_iso(date_dmy)])
    next_day = row[0]["d"] if row else None
    if not next_day:
        return {"state": "no_next_day", "written": 0, "skipped_no_candles": 0, "next_day": None}

    tickers = [s["ticker"] for s in signals]
    candles_by_ticker: dict = {}
    for r in fetchall(conn, """
        SELECT ticker, datetime, open, high, low, close FROM price_history_15m
        WHERE LEFT(datetime, 10) = %s AND ticker = ANY(%s)
        ORDER BY ticker, datetime
    """, [next_day, tickers]):
        candles_by_ticker.setdefault(r["ticker"], []).append(r)

    rows = evaluate_signals(signals, candles_by_ticker, eval_exit_15m)
    for r in rows:
        execute(conn, """
            INSERT INTO bsjp_results (date, ticker, exit_price, status, reason, exit_time, pnl)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (date, ticker) DO UPDATE SET
                exit_price = EXCLUDED.exit_price, status = EXCLUDED.status,
                reason = EXCLUDED.reason, exit_time = EXCLUDED.exit_time,
                pnl = EXCLUDED.pnl, computed_at = NOW()
        """, [date_dmy, r["ticker"], r["exit_price"], r["status"], r["reason"],
              r["exit_time"], r["pnl"]])

    skipped = len(signals) - len(rows)
    log.info("bsjp_results %s: wrote %d, %d without next-day candles (exit day %s)",
             date_dmy, len(rows), skipped, next_day)
    return {"state": "done", "written": len(rows), "skipped_no_candles": skipped, "next_day": next_day}

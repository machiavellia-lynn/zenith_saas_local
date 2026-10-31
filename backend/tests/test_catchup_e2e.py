"""
End-to-end test of ops/weekend_catchup.py against a real Postgres, in an isolated
schema (search_path) so the real tables in `public` are never touched.

Telegram and Yahoo are replaced with deterministic fakes; everything else (parser
output -> savers, summary rebuild, seed/sync, Wyckoff analytics, BSJP indicators,
progress table) is the real code. Skipped automatically if Postgres is unreachable
or the role may not create a schema.
"""
import asyncio
import os
import random
import sys
from datetime import date, datetime, timedelta

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

psycopg2 = pytest.importorskip("psycopg2")
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(ROOT, ".env"))

SCHEMA = "catchup_e2e"
BASE_URL = os.environ.get("DATABASE_URL", "")
TEST_URL = BASE_URL + ("&" if "?" in BASE_URL else "?") + f"options=-csearch_path%3D{SCHEMA}"

TICKERS = ["AAAA", "BBBB", "CCCC", "DDDD", "EEEE"]
HOLIDAY = date(2026, 10, 21)        # Wednesday: no Telegram messages, no prices
FIRST, LAST = date(2026, 10, 19), date(2026, 10, 30)
NOW = datetime(2026, 11, 1, 10, 0)  # Sunday, WIB


def _connect(url):
    import psycopg2.extras
    return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor, connect_timeout=5)


@pytest.fixture(scope="module")
def env():
    if not BASE_URL:
        pytest.skip("DATABASE_URL not set")
    try:
        admin = _connect(BASE_URL)
        admin.autocommit = True
        cur = admin.cursor()
        cur.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
        cur.execute(f"CREATE SCHEMA {SCHEMA}")
    except Exception as e:  # unreachable DB, or no CREATE privilege
        pytest.skip(f"cannot create isolated schema: {e}")

    import core.db as cdb
    cdb_old = cdb.DATABASE_URL
    cdb.DATABASE_URL = TEST_URL
    cdb._local.conn = None
    from core.db_schema import ensure_schema
    ensure_schema()
    yield
    try:
        c = getattr(cdb._local, "conn", None)
        if c is not None:
            c.close()
        cdb._local.conn = None
    finally:
        cdb.DATABASE_URL = cdb_old
        cur.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
        admin.close()


@pytest.fixture
def conn(env):
    c = _connect(TEST_URL)
    cur = c.cursor()
    for t in ("raw_messages", "raw_mf_messages", "eod_summary", "price_history",
              "ticker_universe", "catchup_day_status", "corporate_events"):
        cur.execute(f"TRUNCATE {t}")
    c.commit()
    yield c
    c.close()


class Fakes:
    def __init__(self):
        self.scans = []
        self.fetches = []
        self.yahoo_ratio = 1.0   # fraction of tickers that "return data"


def _weekday_list(a, b):
    out, d = [], a
    while d <= b:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _install_fakes(monkeypatch, conn):
    import ops.weekend_catchup as W
    import data.price_fetch as pf
    from scraper.scraper_saver import save_sm_bm_rows

    fk = Fakes()
    monkeypatch.setattr(W, "YAHOO_CHUNK_SLEEP", 0)
    monkeypatch.setattr(W.time, "sleep", lambda s: None)

    async def fake_scan(c, min_dt):
        fk.scans.append(min_dt)
        saved = 0
        mid = 1000 * (len(fk.scans))
        for d in _weekday_list(FIRST, LAST):
            if d == HOLIDAY or (min_dt and d < min_dt):
                continue
            for i, t in enumerate(TICKERS):
                mid += 1
                row = {
                    "channel": "smart" if i % 2 == 0 else "bad", "date": d.strftime("%d-%m-%Y"),
                    "time": "10:00:00", "tx_count": 3, "ticker": t, "price": 1000 + i,
                    "gain_pct": 1.0, "freq": 10, "value_raw": "1.0 M", "value_numeric": 1.0,
                    "avg_mf_raw": "0.5 M", "avg_mf_numeric": 0.5, "mf_delta_raw": "1.0 M",
                    "mf_delta_numeric": 1.0 + i, "vol_x": 2.0, "signal": "x",
                }
                saved += save_sm_bm_rows(c, mid, [row])
        c.commit()
        return len(TICKERS) * 10, saved

    monkeypatch.setattr(W, "_scan_history", fake_scan)

    def fake_yahoo(c, tickers, date_from, date_to=None, progress_cb=None):
        fk.fetches.append((date_from, date_to, len(tickers)))
        d0 = datetime.strptime(date_from, "%d-%m-%Y").date()
        d1 = datetime.strptime(date_to or date_from, "%d-%m-%Y").date()
        rng = random.Random(7)
        # A persistent outage answers for the same fixed subset on every call.
        n_serve = max(1, int(len(TICKERS) * fk.yahoo_ratio))
        served = set(TICKERS[:n_serve]) & set(tickers)
        price = {t: 1000.0 + 50 * i for i, t in enumerate(TICKERS)}
        ins = 0
        for d in _weekday_list(d0, d1):
            for t in TICKERS:
                price[t] *= 1 + rng.uniform(-0.02, 0.02)
                if d == HOLIDAY or t not in served:
                    continue
                p = round(price[t])
                cur = c.cursor()
                cur.execute("""
                    INSERT INTO price_history (date, ticker, open, high, low, close, volume)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (date, ticker) DO UPDATE SET close = EXCLUDED.close
                """, [d.strftime("%Y-%m-%d"), t, p, round(p * 1.01), round(p * 0.99), p, 1_000_000])
                ins += 1
        return {"ok": True, "tickers": len(tickers), "rows_inserted": ins, "failed_count": 0}

    monkeypatch.setattr(pf, "fetch_daily_yahoo", fake_yahoo)
    return fk


def _run(conn, now=NOW, **kw):
    import ops.weekend_catchup as W
    from ops.catchup_lib import WIB
    args = W.parse_args([])
    for k, v in kw.items():
        setattr(args, k, v)
    return W._pipeline(conn, now.replace(tzinfo=WIB), args)


def _statuses(conn, stage):
    cur = conn.cursor()
    cur.execute("SELECT date, status FROM catchup_day_status WHERE stage=%s", [stage])
    rows = cur.fetchall()
    conn.rollback()
    return {r["date"]: r["status"] for r in rows}


class TestEndToEnd:
    def test_full_run_then_idempotent(self, conn, monkeypatch, capsys):
        fk = _install_fakes(monkeypatch, conn)
        rc = _run(conn)
        out = capsys.readouterr().out
        assert rc == 0, out

        days = _weekday_list(FIRST, LAST)
        assert len(days) == 10
        hol = HOLIDAY.strftime("%d-%m-%Y")

        # fresh DB -> exactly one unbounded scan
        assert fk.scans == [None]

        tg = _statuses(conn, "telegram")
        assert tg[hol] == "holiday" and sum(v == "done" for v in tg.values()) == 9
        for stage in ("summary", "daily_ohlcv", "seed_sync", "analytics", "bsjp_ind"):
            st = _statuses(conn, stage)
            assert len(st) == 10, (stage, st)
            assert st[hol] in ("skipped", "holiday"), (stage, st[hol])
            assert sum(v == "done" for v in st.values()) == 9, (stage, st)

        # BSJP stages are off by default: no rows at all
        for stage in ("m15", "bsjp_scan", "bsjp_result"):
            assert _statuses(conn, stage) == {}

        # real analytics actually ran: phase/sri filled for the last day
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS n, COUNT(phase) AS p FROM eod_summary WHERE date=%s",
                    [LAST.strftime("%d-%m-%Y")])
        r = cur.fetchone()
        assert r["n"] == len(TICKERS) and r["p"] == len(TICKERS)
        # warm-up history was fetched far before the first Telegram day
        cur.execute("SELECT MIN(date) AS d FROM price_history")
        assert cur.fetchone()["d"] < "2026-01-01"
        conn.rollback()

        # second run: nothing to do -> no scan, no fetch, silent
        scans, fetches = len(fk.scans), len(fk.fetches)
        rc = _run(conn)
        assert rc == 0
        assert len(fk.scans) == scans and len(fk.fetches) == fetches
        assert capsys.readouterr().out == ""

    def test_resume_recomputes_only_missing_stage(self, conn, monkeypatch, capsys):
        fk = _install_fakes(monkeypatch, conn)
        assert _run(conn) == 0
        capsys.readouterr()
        last3 = [d.strftime("%d-%m-%Y") for d in _weekday_list(FIRST, LAST)[-3:]]
        cur = conn.cursor()
        cur.execute("DELETE FROM catchup_day_status WHERE stage IN ('analytics','bsjp_ind') AND date = ANY(%s)",
                    [last3])
        conn.commit()
        scans, fetches = len(fk.scans), len(fk.fetches)
        assert _run(conn) == 0
        out = capsys.readouterr().out
        assert "analytics: 3 hari dihitung" in out and "bsjp_ind: 3 hari dihitung" in out
        assert len(fk.scans) == scans and len(fk.fetches) == fetches  # no re-fetch

    def test_yahoo_outage_is_not_mislabelled_as_holiday(self, conn, monkeypatch, capsys):
        fk = _install_fakes(monkeypatch, conn)
        fk.yahoo_ratio = 0.2          # 1 of 5 tickers answers: an outage
        assert _run(conn) == 0
        out = capsys.readouterr().out
        assert "Yahoo bermasalah" in out
        st = _statuses(conn, "daily_ohlcv")
        assert not any(v in ("done", "holiday") for v in st.values()), st
        # and nothing downstream ran on missing prices
        assert _statuses(conn, "analytics") == {}
        # recovery: Yahoo comes back -> next run completes
        fk.yahoo_ratio = 1.0
        assert _run(conn) == 0
        assert sum(v == "done" for v in _statuses(conn, "analytics").values()) == 9

    def test_telegram_session_missing_blocks_cleanly(self, conn, monkeypatch, capsys):
        import ops.weekend_catchup as W
        _install_fakes(monkeypatch, conn)

        async def blocked(c, min_dt):
            raise W.SessionError("session file not found")

        monkeypatch.setattr(W, "_scan_history", blocked)
        assert _run(conn) == 3
        assert "DIBLOKIR" in capsys.readouterr().out
        assert _statuses(conn, "telegram") == {}

    def test_from_to_limits_range(self, conn, monkeypatch, capsys):
        from ops.catchup_lib import parse_dmy
        fk = _install_fakes(monkeypatch, conn)
        assert _run(conn, date_from=date(2026, 10, 26), date_to=parse_dmy("28-10-2026")) == 0
        assert set(_statuses(conn, "analytics")) == {"26-10-2026", "27-10-2026", "28-10-2026"}

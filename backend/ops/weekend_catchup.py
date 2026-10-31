#!/usr/bin/env python
"""
weekend_catchup.py — single entry point that brings the local Postgres up to date.

Zenith used to run as a daily realtime daemon. On the laptop it runs only on
Saturday/Sunday (WIB): read the BST Telegram history for every finished trading
day that is still incomplete, pull daily prices from Yahoo, and compute the flow
+ Wyckoff + BSJP-indicator analytics. Triggered by a Hermes cron every 30 minutes
(--no-agent); it exits silently when there is nothing to do.

    python ops/weekend_catchup.py              # normal (weekend gate applies)
    python ops/weekend_catchup.py --status     # per-stage progress, read-only
    python ops/weekend_catchup.py --dry-run    # show the plan, write nothing
    python ops/weekend_catchup.py --force      # ignore the weekend gate (testing)

Progress lives in catchup_day_status (one row per date x stage), so a Saturday
run followed by a Sunday run never repeats finished work, and a stage is judged
by its own marker rather than by whether a table "looks" populated.

The BSJP algo is disabled by default (no 15m candles are fetched); set
BSJP_CATCHUP=1 to also run the m15 / bsjp_scan / bsjp_result stages.

Exit codes: 0 ok or nothing to do · 1 a stage failed · 3 Telegram session missing
or not authorised · 4 bad arguments.
"""
import argparse
import asyncio
import logging
import logging.handlers
import os
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Windows consoles (cp950 on this laptop) choke on the emoji in the project's log
# lines; force UTF-8 before anything is printed or imported.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")  # must precede `import config`

from ops import catchup_lib as L  # noqa: E402
from ops.catchup_lib import WIB, dmy, iso  # noqa: E402

STATE_DIR = ROOT / "ops" / "state"
LOCK_PATH = STATE_DIR / "catchup.lock"
LOG_PATH = STATE_DIR / "catchup.log"

log = logging.getLogger("zenith.ops.catchup")

YAHOO_CHUNK = 100          # tickers per Yahoo batch
YAHOO_CHUNK_SLEEP = 2.0    # seconds between batches
YAHOO_RETRY_ROUNDS = 2     # extra passes over tickers that returned nothing
MAX_ATTEMPTS = 3           # runs a thin / empty price day is retried before accepting
M15_MAX_AGE_DAYS = 55      # Yahoo serves 15m candles for ~60 days only


# ══════════════════════════════════════════════════════════════════════════════
# logging
# ══════════════════════════════════════════════════════════════════════════════

def setup_logging(verbose: bool):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s")
    fh = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    zen = logging.getLogger("zenith")
    zen.setLevel(logging.INFO)
    zen.addHandler(fh)
    if verbose:
        sh = logging.StreamHandler(sys.stderr)
        sh.setFormatter(fmt)
        zen.addHandler(sh)


def quiet_console(verbose: bool):
    """Importing scraper_daily attaches a stderr handler to the 'zenith' logger.
    A --no-agent cron treats any output as something to deliver, so drop it
    unless --verbose (everything still goes to the log file)."""
    if verbose:
        return
    zen = logging.getLogger("zenith")
    for h in list(zen.handlers):
        if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler):
            zen.removeHandler(h)


# ══════════════════════════════════════════════════════════════════════════════
# progress table
# ══════════════════════════════════════════════════════════════════════════════

def status_table_exists(conn) -> bool:
    cur = conn.cursor()
    cur.execute("SELECT to_regclass('catchup_day_status') AS t")  # search_path-aware
    row = cur.fetchone()
    conn.rollback()
    return bool(row and row["t"])


def load_status(conn, stage: str) -> dict:
    """{DD-MM-YYYY: status} for one stage."""
    from core.db import fetchall
    return {r["date"]: r["status"] for r in
            fetchall(conn, "SELECT date, status FROM catchup_day_status WHERE stage = %s", [stage])}


def load_detail(conn, stage: str) -> dict:
    from core.db import fetchall
    return {r["date"]: (r["status"], r["detail"]) for r in
            fetchall(conn, "SELECT date, status, detail FROM catchup_day_status WHERE stage = %s", [stage])}


def mark(conn, date_dmy: str, stage: str, status: str, detail: str = None):
    from core.db import execute
    execute(conn, """
        INSERT INTO catchup_day_status (date, stage, status, detail)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (date, stage) DO UPDATE
            SET status = EXCLUDED.status, detail = EXCLUDED.detail, done_at = NOW()
    """, [date_dmy, stage, status, detail])


def known_range_start(conn):
    """Earliest date we already hold Telegram data or progress for, or None."""
    from core.db import fetchall
    parts = ["SELECT MIN(TO_DATE(date, 'DD-MM-YYYY')) AS d FROM raw_messages",
             "SELECT MIN(TO_DATE(date, 'DD-MM-YYYY')) FROM raw_mf_messages"]
    if status_table_exists(conn):
        parts.append("SELECT MIN(TO_DATE(date, 'DD-MM-YYYY')) FROM catchup_day_status")
    rows = fetchall(conn, "SELECT MIN(d) AS d FROM (" + " UNION ALL ".join(parts) + ") t")
    return rows[0]["d"] if rows and rows[0]["d"] else None


def select_work(conn, days: list, stage: str, prereq: str):
    """Pick the dates a stage may process now.
    Returns (work, n_skipped). Chronological prefix only: a date whose prerequisite
    stage is not final blocks every later date. Dates whose prerequisite ended as
    holiday/skipped are marked skipped here (nothing to compute for them)."""
    st = load_status(conn, stage)
    pr = load_status(conn, prereq)
    ready = L.ready_prefix(L.pending_dates(days, st), pr)
    work, skipped = [], 0
    for d in ready:
        up = pr[dmy(d)]
        if up == "done":
            work.append(d)
        else:
            mark(conn, dmy(d), stage, "skipped", f"upstream_{up}")
            skipped += 1
    conn.commit()
    return work, skipped


# ══════════════════════════════════════════════════════════════════════════════
# context
# ══════════════════════════════════════════════════════════════════════════════

class Ctx:
    def __init__(self, conn, now, args):
        self.conn = conn
        self.now = now
        self.args = args
        self.bsjp = os.environ.get("BSJP_CATCHUP", "0") == "1"
        self.lines = []          # summary lines printed to stdout at the end
        self.work_done = False
        self.failed = False
        self.telegram_blocked = False

    def out(self, msg: str):
        log.info(msg)
        self.lines.append(msg)


# ══════════════════════════════════════════════════════════════════════════════
# stage: telegram
# ══════════════════════════════════════════════════════════════════════════════

class SessionError(Exception):
    pass


async def _scan_history(conn, min_dt):
    """One pass over the four topics, newest→oldest, saving every message whose
    embedded date is >= min_dt (None = the entire history). Returns
    (scanned, saved). Raises SessionError if the session is not logged in."""
    from telethon import TelegramClient
    from config import TG_API_ID, TG_API_HASH, TG_SESSION_PATH, TG_GROUP_ID
    from core.db import transaction
    from scraper.scraper_parser import parse_joker_message, parse_mf_message
    from scraper.scraper_saver import save_sm_bm_rows, save_mf_rows
    from scraper.scraper_daily import (
        ALL_TOPICS, SM_BM_TOPICS, TOPIC_LABELS, TOPIC_CHANNELS, _ensure_conn,
    )

    if not (os.path.exists(TG_SESSION_PATH + ".session") or os.path.exists(TG_SESSION_PATH)):
        raise SessionError(f"session file not found: {TG_SESSION_PATH}.session — run ops/tg_login.py")

    client = TelegramClient(TG_SESSION_PATH, TG_API_ID, TG_API_HASH)
    await client.connect()
    total_scanned = total_saved = 0
    try:
        if not await client.is_user_authorized():
            raise SessionError("session not authorised — run ops/tg_login.py")
        await client.get_dialogs(limit=50)

        for topic_id in sorted(ALL_TOPICS):
            label, channel = TOPIC_LABELS[topic_id], TOPIC_CHANNELS[topic_id]
            scanned = saved = 0
            conn = _ensure_conn(conn)
            async for message in client.iter_messages(TG_GROUP_ID, reply_to=topic_id, limit=None):
                if not message.text:
                    continue
                text_clean = message.text.replace("```", "").replace("`", "")
                m = re.search(r"(\d{2}-\d{2}-\d{4})", text_clean)
                if not m:
                    continue
                scanned += 1
                try:
                    msg_dt = datetime.strptime(m.group(1), "%d-%m-%Y").date()
                except ValueError:
                    continue
                if min_dt is not None and msg_dt < min_dt:
                    break  # newest→oldest: nothing useful further back in this topic
                try:
                    if topic_id in SM_BM_TOPICS:
                        rows = parse_joker_message(message.text, channel)
                        save = save_sm_bm_rows
                    else:
                        rows = parse_mf_message(message.text, channel)
                        save = save_mf_rows
                    if rows:
                        with transaction(conn):
                            saved += save(conn, message.id, rows)
                except Exception as e:
                    log.warning("  %s msg=%s save failed: %s", label, message.id, e)
                if scanned % 500 == 0:
                    log.info("  %s: scanned=%d new=%d", label, scanned, saved)
            log.info("  %s: scanned=%d new_rows=%d", label, scanned, saved)
            total_scanned += scanned
            total_saved += saved
    finally:
        await client.disconnect()
    return total_scanned, total_saved


def telegram_row_counts(conn, dates_dmy: list) -> dict:
    from core.db import fetchall
    counts = {}
    for tbl in ("raw_messages", "raw_mf_messages"):
        for r in fetchall(conn, f"SELECT date, COUNT(*) AS n FROM {tbl} WHERE date = ANY(%s) GROUP BY date",
                          [dates_dmy]):
            counts[r["date"]] = counts.get(r["date"], 0) + r["n"]
    return counts


def scan_telegram(ctx: Ctx, min_dt, n_pending: int = 0) -> bool:
    """One pass over the Telegram history. Returns True if it ran to completion;
    a missing/unauthorised session or any error is recorded on ctx instead."""
    ctx.out(f"telegram: menelusuri riwayat"
            f"{' sejak ' + dmy(min_dt) if min_dt else ' (seluruhnya)'}"
            f"{', ' + str(n_pending) + ' hari tertunda' if n_pending else ''}")
    try:
        scanned, saved = asyncio.run(_scan_history(ctx.conn, min_dt))
    except SessionError as e:
        ctx.telegram_blocked = True
        ctx.out(f"telegram: DIBLOKIR — {e}")
        return False
    except Exception as e:
        ctx.failed = True
        log.exception("telegram scan failed")
        ctx.out(f"telegram: GAGAL — {type(e).__name__}: {e}")
        return False
    ctx.work_done = True
    ctx.out(f"telegram: {scanned} pesan dipindai, {saved} baris baru")
    return True


def classify_telegram_days(ctx: Ctx, pend: list):
    """After a completed scan, mark each pending day done or holiday from the
    raw rows now in the database."""
    counts = telegram_row_counts(ctx.conn, [dmy(d) for d in pend])
    verdict = L.classify_telegram(pend, counts, ctx.now, scan_complete=True,
                                  price_only_before=ctx.args.price_only_before)
    for d_str, (status, detail) in verdict.items():
        mark(ctx.conn, d_str, "telegram", status, detail)
    ctx.conn.commit()


# ══════════════════════════════════════════════════════════════════════════════
# stages: summary / daily_ohlcv / seed_sync / analytics / bsjp_ind
# ══════════════════════════════════════════════════════════════════════════════

def stage_summary(ctx: Ctx, days: list):
    from algo.summary_rebuild import rebuild_summary_for_date
    work, skipped = select_work(ctx.conn, days, "summary", "telegram")
    for d in work:
        rebuild_summary_for_date(ctx.conn, dmy(d))
        mark(ctx.conn, dmy(d), "summary", "done")
        ctx.conn.commit()
    if work or skipped:
        ctx.work_done = ctx.work_done or bool(work)
        ctx.out(f"summary: {len(work)} hari dibangun, {skipped} dilewati")


def _fetch_prices(ctx: Ctx, tickers: list, d_from: date, d_to: date) -> int:
    """Yahoo daily OHLCV in throttled batches, then re-ask only the tickers that
    returned nothing. Returns how many tickers ended up with at least one row."""
    from core.db import fetchall
    from data.price_fetch import fetch_daily_yahoo

    def have(tks):
        rows = fetchall(ctx.conn, """
            SELECT DISTINCT ticker FROM price_history
            WHERE ticker = ANY(%s) AND date >= %s AND date <= %s
        """, [tks, iso(d_from), iso(d_to)])
        ctx.conn.rollback()
        return {r["ticker"] for r in rows}

    todo = list(tickers)
    for rnd in range(YAHOO_RETRY_ROUNDS + 1):
        for i in range(0, len(todo), YAHOO_CHUNK):
            chunk = todo[i:i + YAHOO_CHUNK]
            fetch_daily_yahoo(ctx.conn, chunk, dmy(d_from), dmy(d_to))
            ctx.conn.commit()
            time.sleep(YAHOO_CHUNK_SLEEP)
        got = have(tickers)
        todo = [t for t in tickers if t not in got]
        log.info("yahoo round %d: %d/%d tickers have data", rnd, len(got), len(tickers))
        if not todo or rnd == YAHOO_RETRY_ROUNDS:
            return len(got)
        time.sleep(10.0)
    return 0


def stage_daily_ohlcv(ctx: Ctx, days: list):
    from core.db import fetchall
    work, skipped = select_work(ctx.conn, days, "daily_ohlcv", "summary")
    if not work:
        if skipped:
            ctx.out(f"daily_ohlcv: {skipped} dilewati")
        return

    tickers = [r["ticker"] for r in fetchall(
        ctx.conn, "SELECT ticker FROM ticker_universe WHERE is_active = TRUE ORDER BY ticker")]
    if ctx.args.only_tickers:
        tickers = [t for t in tickers if t in ctx.args.only_tickers]
    ctx.conn.rollback()
    if not tickers:
        ctx.out("daily_ohlcv: ticker_universe kosong — tidak ada yang diambil")
        return

    first, last = work[0], work[-1]
    have_hist = fetchall(ctx.conn, "SELECT COUNT(DISTINCT date) AS n FROM price_history WHERE date < %s",
                         [iso(first)])[0]["n"]
    ctx.conn.rollback()
    d_from = L.warmup_start(first, have_hist)
    ctx.out(f"daily_ohlcv: {len(tickers)} ticker, Yahoo {dmy(d_from)} → {dmy(last)} "
            f"({len(work)} hari kerja diproses)")
    with_data = _fetch_prices(ctx, tickers, d_from, last)
    ctx.work_done = True

    counts = {r["date"]: r["n"] for r in fetchall(ctx.conn, """
        SELECT date, COUNT(*) AS n FROM price_history
        WHERE date >= %s AND date <= %s GROUP BY date
    """, [iso(first), iso(last)])}
    ctx.conn.rollback()
    counts = {dmy(datetime.strptime(k, "%Y-%m-%d").date()): v for k, v in counts.items()}

    # Judge against the whole fetched range, not just the days being processed:
    # "thin" is relative to the median, which is meaningless for a 1-day batch.
    verdict = L.classify_ohlcv(L.weekdays(d_from, last), counts, len(tickers), with_data, ctx.now)
    fetch_ok = with_data / len(tickers) >= L.FETCH_OK_MIN_RATIO
    prev = load_detail(ctx.conn, "daily_ohlcv")
    n_done = n_hol = n_retry = 0
    for d in work:
        k = dmy(d)
        if k in verdict:
            status, detail = verdict[k]
            mark(ctx.conn, k, "daily_ohlcv", status, detail)
            n_done += status == "done"
            n_hol += status == "holiday"
        elif fetch_ok:
            # Unclassified although the fetch itself worked: a thin day, or a
            # zero day too fresh to call. Retry a few runs, then accept.
            m = re.search(r"attempt=(\d+)", (prev.get(k) or (None, ""))[1] or "")
            attempts = int(m.group(1)) + 1 if m else 1
            n = counts.get(k, 0)
            if attempts >= MAX_ATTEMPTS:
                mark(ctx.conn, k, "daily_ohlcv", "done" if n else "holiday",
                     f"accepted_after_{attempts}_attempts rows={n}")
                n_done += bool(n)
                n_hol += not n
            else:
                mark(ctx.conn, k, "daily_ohlcv", "retry", f"attempt={attempts} rows={n}")
                n_retry += 1
    ctx.conn.commit()
    ctx.out(f"daily_ohlcv: {n_done} selesai, {n_hol} libur bursa, {n_retry} diulang"
            f"{'' if fetch_ok else ' — Yahoo bermasalah (' + str(with_data) + '/' + str(len(tickers)) + ' ticker), tidak ada hari yang diklasifikasi'}")


def stage_seed_sync(ctx: Ctx, days: list):
    from algo.summary_rebuild import seed_eod_from_price_history
    from data.price_fetch import sync_eod_prices_from_history
    work, skipped = select_work(ctx.conn, days, "seed_sync", "daily_ohlcv")
    if not work:
        if skipped:
            ctx.out(f"seed_sync: {skipped} dilewati")
        return
    d_from, d_to = dmy(work[0]), dmy(work[-1])
    seeded = seed_eod_from_price_history(ctx.conn, d_from, d_to)
    synced = sync_eod_prices_from_history(ctx.conn, d_from, d_to)
    for d in work:
        mark(ctx.conn, dmy(d), "seed_sync", "done")
    ctx.conn.commit()
    ctx.work_done = True
    ctx.out(f"seed_sync: {len(work)} hari ({d_from} → {d_to}), {seeded} baris di-seed, {synced} harga disinkronkan")


def stage_analytics(ctx: Ctx, days: list):
    from algo.analytics_daily import compute_analytics_for_date
    work, skipped = select_work(ctx.conn, days, "analytics", "seed_sync")
    n = 0
    for d in work:  # strictly chronological: SRI / ATR / MA200 look back over earlier days
        updated = compute_analytics_for_date(ctx.conn, dmy(d))
        if not updated:
            ctx.conn.rollback()
            ctx.out(f"analytics: {dmy(d)} tidak ada baris eod_summary — berhenti di sini")
            break
        mark(ctx.conn, dmy(d), "analytics", "done", f"tickers={updated}")
        ctx.conn.commit()
        n += 1
    if n or skipped:
        ctx.work_done = ctx.work_done or bool(n)
        ctx.out(f"analytics: {n} hari dihitung, {skipped} dilewati")


def stage_bsjp_ind(ctx: Ctx, days: list):
    from algo.analytics_bsjp import compute_bsjp_for_date
    work, skipped = select_work(ctx.conn, days, "bsjp_ind", "analytics")
    n = 0
    for d in work:
        updated = compute_bsjp_for_date(ctx.conn, dmy(d))
        if not updated:
            ctx.conn.rollback()
            ctx.out(f"bsjp_ind: {dmy(d)} tidak ada baris price_history — berhenti di sini")
            break
        mark(ctx.conn, dmy(d), "bsjp_ind", "done", f"tickers={updated}")
        ctx.conn.commit()
        n += 1
    if n or skipped:
        ctx.work_done = ctx.work_done or bool(n)
        ctx.out(f"bsjp_ind: {n} hari dihitung, {skipped} dilewati")


# ══════════════════════════════════════════════════════════════════════════════
# optional BSJP stages (BSJP_CATCHUP=1)
# ══════════════════════════════════════════════════════════════════════════════

def stage_m15(ctx: Ctx, days: list):
    from data.price_fetch import backfill_intraday_15m
    work, skipped = select_work(ctx.conn, days, "m15", "bsjp_ind")
    today = ctx.now.astimezone(WIB).date()
    fetchable = []
    for d in work:
        if (today - d).days > M15_MAX_AGE_DAYS:
            mark(ctx.conn, dmy(d), "m15", "skipped", "beyond_yahoo_15m_window")
        else:
            fetchable.append(d)
    ctx.conn.commit()
    if fetchable:
        res = backfill_intraday_15m(ctx.conn, dmy(fetchable[0]), dmy(fetchable[-1]))
        ctx.conn.commit()
        for d in fetchable:
            mark(ctx.conn, dmy(d), "m15", "done", f"rows={res.get('rows_inserted', 0)}")
        ctx.conn.commit()
        ctx.work_done = True
        ctx.out(f"m15: {len(fetchable)} hari, {res.get('rows_inserted', 0)} candle")


def stage_bsjp_scan(ctx: Ctx, days: list):
    from scraper.scraper_daily import run_bsjp_scan
    work, skipped = select_work(ctx.conn, days, "bsjp_scan", "m15")
    n = 0
    for d in work:
        sig = run_bsjp_scan(ctx.conn, date_dmy=dmy(d), defer_pricing=False)
        mark(ctx.conn, dmy(d), "bsjp_scan", "done", f"signals={sig}")
        ctx.conn.commit()
        n += 1
    if n:
        ctx.work_done = True
        ctx.out(f"bsjp_scan: {n} hari dipindai")


def stage_bsjp_result(ctx: Ctx, days: list):
    from ops.bsjp_results import write_results_for_date
    work, skipped = select_work(ctx.conn, days, "bsjp_result", "bsjp_scan")
    n = 0
    for d in work:
        res = write_results_for_date(ctx.conn, dmy(d))
        if res["state"] == "no_next_day":
            ctx.conn.rollback()
            break  # exit day's candles not available yet — normal, one trading day behind
        mark(ctx.conn, dmy(d), "bsjp_result", "done", f"{res['state']} written={res['written']}")
        ctx.conn.commit()
        n += 1
    if n:
        ctx.work_done = True
        ctx.out(f"bsjp_result: {n} hari dievaluasi")


# ══════════════════════════════════════════════════════════════════════════════
# status / dry-run
# ══════════════════════════════════════════════════════════════════════════════

def all_stages(bsjp: bool) -> list:
    return L.STAGES + (L.BSJP_STAGES if bsjp else [])


def print_status(conn, now, args, bsjp: bool, dry_run: bool = False):
    last_day = L.last_completed_day(now)
    start = args.date_from or known_range_start(conn)
    conn.rollback()
    gate = "BUKA" if (L.is_weekend_wib(now) or args.force) else "TUTUP (bukan Sabtu/Minggu WIB)"
    print(f"Sekarang (WIB): {now.astimezone(WIB):%Y-%m-%d %H:%M} · gerbang akhir pekan: {gate}")
    print(f"Hari bursa selesai terakhir: {dmy(last_day)}")
    if start is None:
        print("Rentang: belum diketahui — sesi pertama akan menelusuri seluruh riwayat Telegram.")
        return
    days = L.weekdays(start, last_day)
    print(f"Rentang: {dmy(start)} → {dmy(last_day)} ({len(days)} hari kerja)")
    have_tbl = status_table_exists(conn)
    print(f"\n{'tahap':<13}{'done':>6}{'libur':>7}{'skip':>6}{'retry':>7}{'tertunda':>10}")
    for stage in all_stages(bsjp):
        st = load_status(conn, stage) if have_tbl else {}
        c = {"done": 0, "holiday": 0, "skipped": 0, "retry": 0}
        pend = 0
        for d in days:
            s = st.get(dmy(d))
            if s in c:
                c[s] += 1
            if s not in L.FINAL:
                pend += 1
        print(f"{stage:<13}{c['done']:>6}{c['holiday']:>7}{c['skipped']:>6}{c['retry']:>7}{pend:>10}")
    if not bsjp:
        print("\nTahap m15 / bsjp_scan / bsjp_result: DINONAKTIFKAN (BSJP_CATCHUP=0)")
    if dry_run:
        pend_any = any(L.pending_dates(days, load_status(conn, s) if have_tbl else {}) for s in all_stages(bsjp))
        print("\n[dry-run] " + ("akan memproses kolom 'tertunda' di atas, mulai dari tahap telegram."
                               if pend_any else "tidak ada yang perlu dikerjakan."))


# ══════════════════════════════════════════════════════════════════════════════
# main
# ══════════════════════════════════════════════════════════════════════════════

def parse_args(argv):
    p = argparse.ArgumentParser(description="Weekend catch-up for the local Zenith database.")
    p.add_argument("--status", action="store_true", help="show per-stage progress and exit")
    p.add_argument("--dry-run", action="store_true", help="show the plan; write nothing, call no API")
    p.add_argument("--force", action="store_true", help="ignore the Saturday/Sunday gate")
    p.add_argument("--from", dest="date_from", help="earliest date to process (DD-MM-YYYY)")
    p.add_argument("--to", dest="date_to", help="latest date to process (DD-MM-YYYY)")
    p.add_argument("--price-only-before", dest="price_only_before",
                   help="days before this date (DD-MM-YYYY) predate the Telegram history: "
                        "fill prices/analytics only, no SM/BM/MF")
    p.add_argument("--only-tickers", help="comma list; restrict the Yahoo fetch (testing)")
    p.add_argument("--now", help="override the clock, ISO local WIB e.g. 2026-10-31T10:00 (testing)")
    p.add_argument("--verbose", action="store_true", help="also log to stderr")
    a = p.parse_args(argv)
    try:
        a.date_from = L.parse_dmy(a.date_from) if a.date_from else None
        a.date_to = L.parse_dmy(a.date_to) if a.date_to else None
        a.price_only_before = L.parse_dmy(a.price_only_before) if a.price_only_before else None
        a.now = datetime.fromisoformat(a.now).replace(tzinfo=WIB) if a.now else None
    except ValueError as e:
        p.error(f"bad date: {e}")
    a.only_tickers = {t.strip().upper() for t in a.only_tickers.split(",")} if a.only_tickers else None
    return a


def run(argv=None) -> int:
    try:
        args = parse_args(argv)
    except SystemExit:
        return 4
    setup_logging(args.verbose)
    now = args.now or datetime.now(WIB)
    bsjp = os.environ.get("BSJP_CATCHUP", "0") == "1"

    from core.db import get_scraper_db
    conn = get_scraper_db()
    try:
        if args.status or args.dry_run:
            print_status(conn, now, args, bsjp, dry_run=args.dry_run)
            return 0

        if not (args.force or L.is_weekend_wib(now)):
            log.info("gate closed: not Saturday/Sunday WIB")
            return 0

        try:
            lock = L.FileLock(str(LOCK_PATH)).acquire()
        except L.LockHeld as e:
            log.info("skip: %s", e)
            return 0
        try:
            from core.db_schema import ensure_schema
            ensure_schema()
            return _pipeline(conn, now, args)
        finally:
            lock.release()
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _pipeline(conn, now, args) -> int:
    ctx = Ctx(conn, now, args)
    last_day = L.last_completed_day(now)
    if args.date_to:
        last_day = min(last_day, args.date_to)

    start = args.date_from or known_range_start(conn)
    conn.rollback()

    # First ever run: no range yet, so one unbounded scan discovers it. That same
    # scan already covers every day, so it is not repeated below.
    scanned_already = False
    if start is None:
        log.info("fresh database — discovering range from the full Telegram history")
        ok = scan_telegram(ctx, None)
        quiet_console(args.verbose)
        if not ok:
            return _finish(ctx)
        scanned_already = True
        start = known_range_start(conn)
        conn.rollback()
        if start is None:
            ctx.out("telegram: tidak ada pesan yang bisa dibaca di grup — periksa keanggotaan akun")
            ctx.failed = True
            return _finish(ctx)

    days = L.weekdays(start, last_day)
    if not days:
        return _finish(ctx)

    # telegram (skip the scan entirely when nothing is pending)
    pend_tg = L.pending_dates(days, load_status(conn, "telegram"))
    conn.rollback()
    if pend_tg:
        if scanned_already or scan_telegram(ctx, pend_tg[0], len(pend_tg)):
            classify_telegram_days(ctx, pend_tg)
        quiet_console(args.verbose)

    stages = [stage_summary, stage_daily_ohlcv, stage_seed_sync, stage_analytics, stage_bsjp_ind]
    if ctx.bsjp:
        stages += [stage_m15, stage_bsjp_scan, stage_bsjp_result]
    for fn in stages:
        try:
            fn(ctx, days)
        except Exception as e:
            conn.rollback()
            ctx.failed = True
            log.exception("stage %s failed", fn.__name__)
            ctx.out(f"{fn.__name__}: GAGAL — {type(e).__name__}: {e}")
            break

    if ctx.work_done and not ctx.failed:
        try:
            from algo.corporate_actions import detect_back_adjustments
            flagged = detect_back_adjustments(conn)
            conn.commit()
            if flagged:
                ctx.out(f"corporate action: {len(flagged)} ticker ditandai 'suspected' ({', '.join(flagged[:8])})")
        except Exception as e:
            conn.rollback()
            log.warning("detect_back_adjustments failed: %s", e)
    return _finish(ctx)


def _finish(ctx: Ctx) -> int:
    if ctx.work_done or ctx.failed or ctx.telegram_blocked:
        print("\n".join(ctx.lines))
    if ctx.failed:
        return 1
    if ctx.telegram_blocked:
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(run())

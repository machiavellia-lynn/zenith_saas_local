"""
catchup_lib.py — pure helpers for ops/weekend_catchup.py.
RULE: No DB, no network, no Telegram. Everything here is deterministic given its
      inputs so the gap/holiday/gate decisions can be unit-tested with fake data.
Dates: DD-MM-YYYY strings (eod_summary / catchup_day_status convention) unless a
       function says otherwise.
"""
import os
import statistics
import time
from datetime import date, datetime, timedelta, timezone

WIB = timezone(timedelta(hours=7))

# A trading day is "finished" for the catch-up once WIB clock passes this hour.
MARKET_DONE_HOUR = 17

# Stages in strict dependency order. Per-date; each needs the previous one final.
STAGES = ["telegram", "summary", "daily_ohlcv", "seed_sync", "analytics", "bsjp_ind"]
# Only run when BSJP_CATCHUP=1 (BSJP algo is disabled by default).
BSJP_STAGES = ["m15", "bsjp_scan", "bsjp_result"]

FINAL = frozenset({"done", "holiday", "skipped"})

# daily_ohlcv: a day counts as complete at this fraction of the median ticker count.
COVERAGE_MIN_RATIO = 0.80
# daily_ohlcv: below this share of tickers returning any data, the fetch itself is
# treated as failed (rate limit / outage) and no day may be classified.
FETCH_OK_MIN_RATIO = 0.60


# ── date helpers ──────────────────────────────────────────────────────────────

def dmy(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def parse_dmy(s: str) -> date:
    return datetime.strptime(s, "%d-%m-%Y").date()


def weekdays(start: date, end: date) -> list:
    """Mon–Fri dates in [start, end], oldest first. Empty if start > end."""
    out, cur = [], start
    while cur <= end:
        if cur.weekday() < 5:
            out.append(cur)
        cur += timedelta(days=1)
    return out


# ── gates ─────────────────────────────────────────────────────────────────────

def is_weekend_wib(now: datetime) -> bool:
    """now must be tz-aware; evaluated in WIB regardless of the laptop's zone."""
    return now.astimezone(WIB).weekday() >= 5


def last_completed_day(now: datetime) -> date:
    """Most recent weekday whose trading is finished: before today, or today once
    the WIB clock is past MARKET_DONE_HOUR."""
    n = now.astimezone(WIB)
    cand = n.date() if n.hour >= MARKET_DONE_HOUR else n.date() - timedelta(days=1)
    while cand.weekday() >= 5:
        cand -= timedelta(days=1)
    return cand


def too_fresh(d: date, now: datetime) -> bool:
    """True for a day so recent that "no data" might just mean "not published
    yet" rather than "market was closed" — such days are retried, not marked
    holiday."""
    return d >= now.astimezone(WIB).date() - timedelta(days=1)


# ── gap detection ─────────────────────────────────────────────────────────────

def pending_dates(days: list, status: dict) -> list:
    """days: list[date] oldest-first. status: {DD-MM-YYYY: status} for one stage.
    Returns the dates whose status is missing or not final."""
    return [d for d in days if status.get(dmy(d)) not in FINAL]


def ready_prefix(pending: list, prereq_status: dict) -> list:
    """Longest chronological prefix of `pending` whose prerequisite stage is final.
    Stops at the first blocked date so a later date is never processed ahead of an
    earlier one (SRI / ATR / MA200 for day D need day < D to be complete)."""
    out = []
    for d in pending:
        if prereq_status.get(dmy(d)) in FINAL:
            out.append(d)
        else:
            break
    return out


def classify_telegram(days: list, row_counts: dict, now: datetime, scan_complete: bool,
                      price_only_before=None) -> dict:
    """Decide telegram-stage status for each day after a history scan.
    row_counts: {DD-MM-YYYY: raw rows saved in raw_messages + raw_mf_messages}.
    Returns {DD-MM-YYYY: ("done"|"holiday", detail)} — days omitted are left
    pending. A scan that did not run to completion classifies nothing, and a
    zero-row day too recent to be sure of is retried rather than called holiday.
    Days before `price_only_before` predate the Telegram history: they are passed
    on as done (price-only) so the Yahoo stage, not the missing chat, decides
    whether they were trading days."""
    if not scan_complete:
        return {}
    out = {}
    for d in days:
        n = row_counts.get(dmy(d), 0)
        if price_only_before is not None and d < price_only_before:
            out[dmy(d)] = ("done", "price_only")
        elif n > 0:
            out[dmy(d)] = ("done", f"rows={n}")
        elif not too_fresh(d, now):
            out[dmy(d)] = ("holiday", "no_telegram_messages")
    return out


def classify_ohlcv(days: list, counts: dict, tickers_requested: int,
                   tickers_with_data: int, now: datetime) -> dict:
    """Decide daily_ohlcv status for each day after a Yahoo fetch.
    counts: {DD-MM-YYYY: price_history rows}. Returns {date: (status, detail)};
    omitted days stay pending (retried next tick).

    Safeguards against mislabelling an outage as a market holiday:
      * fetch_ok — if too few tickers returned any data, nothing is classified.
      * a zero-row day is only a holiday if a neighbouring weekday in the same
        batch did return data, and the day is not too fresh to trust.
      * a thin day (< COVERAGE_MIN_RATIO of the median) is retried, not accepted."""
    if tickers_requested <= 0:
        return {}
    if tickers_with_data / tickers_requested < FETCH_OK_MIN_RATIO:
        return {}
    nonzero = [counts.get(dmy(d), 0) for d in days if counts.get(dmy(d), 0) > 0]
    if not nonzero:
        return {}
    med = statistics.median(nonzero)
    out = {}
    for d in days:
        n = counts.get(dmy(d), 0)
        if n == 0:
            if not too_fresh(d, now):
                out[dmy(d)] = ("holiday", "no_price_data")
        elif n >= COVERAGE_MIN_RATIO * med:
            out[dmy(d)] = ("done", f"rows={n}")
    return out


def warmup_start(first_day: date, have_history_days: int, need: int = 210) -> date:
    """Earliest calendar date to fetch so MA200 has `need` trading days behind
    first_day. If price_history already holds enough, only a short overlap."""
    if have_history_days >= need:
        return first_day - timedelta(days=3)
    # ~need trading days ≈ need*7/5 calendar days, plus a buffer for IDX holidays:
    # measured on Yahoo, 310 calendar days gave only 200 trading days in 2026.
    return first_day - timedelta(days=int(need * 7 / 5) + 60)


# ── single-instance lock ──────────────────────────────────────────────────────

def pid_alive(pid: int) -> bool:
    """Whether a process exists. Never uses os.kill on Windows: there any signal
    other than CTRL_* maps to TerminateProcess, which would kill the process."""
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return False
        try:
            code = ctypes.c_ulong()
            if not k32.GetExitCodeProcess(h, ctypes.byref(code)):
                return False
            return code.value == STILL_ACTIVE
        finally:
            k32.CloseHandle(h)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class LockHeld(Exception):
    pass


class FileLock:
    """Single-instance lock: an exclusively-created file holding the owner PID.
    A lock whose PID is dead, or that is older than max_age_s, is stale and is
    taken over (a hard-killed run must not wedge the cron forever)."""

    def __init__(self, path: str, max_age_s: int = 12 * 3600):
        self.path = path
        self.max_age_s = max_age_s
        self._held = False

    def _read_pid(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return int(f.read().strip().split()[0])
        except Exception:
            return None

    def _is_stale(self) -> bool:
        try:
            age = time.time() - os.path.getmtime(self.path)
        except OSError:
            return True
        pid = self._read_pid()
        return pid is None or not pid_alive(pid) or age > self.max_age_s

    def acquire(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                if self._is_stale():
                    try:
                        os.remove(self.path)
                    except OSError:
                        pass
                    continue
                raise LockHeld(f"another catch-up is running (pid {self._read_pid()})")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(f"{os.getpid()}\n")
            self._held = True
            return self
        raise LockHeld("could not take over stale lock")

    def release(self):
        if self._held:
            try:
                os.remove(self.path)
            except OSError:
                pass
            self._held = False

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self.release()

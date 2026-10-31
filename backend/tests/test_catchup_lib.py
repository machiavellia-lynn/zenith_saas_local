"""Unit tests for ops/catchup_lib.py — pure logic, no DB / network."""
import os
import sys
from datetime import date, datetime, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ops import catchup_lib as L  # noqa: E402
from ops.catchup_lib import WIB  # noqa: E402


def wib(y, m, d, hh=12, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=WIB)


# 2026-10-30 is a Friday; 10-31 Saturday; 11-01 Sunday.

class TestGates:
    def test_weekend_gate_uses_wib_not_laptop_zone(self):
        # Fri 23:30 WIB == Sat 00:30 in Taipei (UTC+8). Must still be a weekday.
        fri_late = wib(2026, 10, 30, 23, 30)
        assert not L.is_weekend_wib(fri_late)
        assert L.is_weekend_wib(wib(2026, 10, 31, 0, 30))
        assert L.is_weekend_wib(wib(2026, 11, 1, 12))
        assert not L.is_weekend_wib(wib(2026, 11, 2, 12))

    def test_last_completed_day_weekend_is_friday(self):
        assert L.last_completed_day(wib(2026, 10, 31, 10)) == date(2026, 10, 30)
        assert L.last_completed_day(wib(2026, 11, 1, 22)) == date(2026, 10, 30)

    def test_last_completed_day_weekday_cutoff_17(self):
        assert L.last_completed_day(wib(2026, 10, 29, 16, 59)) == date(2026, 10, 28)
        assert L.last_completed_day(wib(2026, 10, 29, 17, 0)) == date(2026, 10, 29)

    def test_last_completed_day_monday_morning_is_friday(self):
        assert L.last_completed_day(wib(2026, 11, 2, 9)) == date(2026, 10, 30)

    def test_too_fresh(self):
        now = wib(2026, 10, 31, 10)
        assert L.too_fresh(date(2026, 10, 30), now)      # yesterday
        assert not L.too_fresh(date(2026, 10, 29), now)


class TestWeekdays:
    def test_skips_weekend(self):
        ds = L.weekdays(date(2026, 10, 29), date(2026, 11, 2))
        assert ds == [date(2026, 10, 29), date(2026, 10, 30), date(2026, 11, 2)]

    def test_empty_when_reversed(self):
        assert L.weekdays(date(2026, 11, 2), date(2026, 10, 29)) == []


class TestGaps:
    DAYS = L.weekdays(date(2026, 10, 26), date(2026, 10, 30))

    def test_pending_excludes_final_statuses(self):
        st = {"26-10-2026": "done", "27-10-2026": "holiday", "28-10-2026": "skipped"}
        assert L.pending_dates(self.DAYS, st) == [date(2026, 10, 29), date(2026, 10, 30)]

    def test_idempotent_second_run_has_nothing_pending(self):
        st = {L.dmy(d): "done" for d in self.DAYS}
        assert L.pending_dates(self.DAYS, st) == []

    def test_ready_prefix_stops_at_first_blocked(self):
        pend = self.DAYS
        prereq = {"26-10-2026": "done", "27-10-2026": "done",
                  "28-10-2026": "pending", "29-10-2026": "done"}
        # 29 must NOT be processed ahead of the blocked 28.
        assert L.ready_prefix(pend, prereq) == [date(2026, 10, 26), date(2026, 10, 27)]

    def test_ready_prefix_holiday_prereq_counts_as_final(self):
        assert L.ready_prefix([date(2026, 10, 26)], {"26-10-2026": "holiday"}) == [date(2026, 10, 26)]


class TestClassifyTelegram:
    NOW = wib(2026, 11, 1, 10)
    DAYS = L.weekdays(date(2026, 10, 26), date(2026, 10, 30))

    def test_rows_done_zero_old_holiday(self):
        counts = {"26-10-2026": 500, "27-10-2026": 480, "29-10-2026": 10}
        out = L.classify_telegram(self.DAYS, counts, self.NOW, scan_complete=True)
        assert out["26-10-2026"] == ("done", "rows=500")
        assert out["28-10-2026"][0] == "holiday"

    def test_incomplete_scan_classifies_nothing(self):
        assert L.classify_telegram(self.DAYS, {}, self.NOW, scan_complete=False) == {}

    def test_zero_row_fresh_day_is_retried_not_holiday(self):
        sat = wib(2026, 10, 31, 10)  # Friday is 1 day old -> might not be published
        out = L.classify_telegram(self.DAYS, {}, sat, scan_complete=True)
        assert "30-10-2026" not in out
        assert out["29-10-2026"][0] == "holiday"

    def test_zero_row_friday_is_holiday_by_sunday(self):
        out = L.classify_telegram(self.DAYS, {}, self.NOW, scan_complete=True)
        assert out["30-10-2026"][0] == "holiday"

    def test_price_only_before_passes_days_on_as_done(self):
        out = L.classify_telegram(self.DAYS, {"29-10-2026": 10}, self.NOW, scan_complete=True,
                                  price_only_before=date(2026, 10, 29))
        assert out["26-10-2026"] == ("done", "price_only")
        assert out["28-10-2026"] == ("done", "price_only")
        assert out["29-10-2026"] == ("done", "rows=10")
        assert out["30-10-2026"][0] == "holiday"

    def test_price_only_before_does_not_apply_to_incomplete_scan(self):
        assert L.classify_telegram(self.DAYS, {}, self.NOW, scan_complete=False,
                                   price_only_before=date(2026, 10, 29)) == {}


class TestClassifyOhlcv:
    NOW = wib(2026, 11, 1, 10)
    DAYS = L.weekdays(date(2026, 10, 26), date(2026, 10, 30))

    def test_normal_week_with_holiday(self):
        counts = {"26-10-2026": 800, "27-10-2026": 790, "28-10-2026": 0,
                  "29-10-2026": 805, "30-10-2026": 800}
        out = L.classify_ohlcv(self.DAYS, counts, 820, 810, self.NOW)
        assert out["28-10-2026"] == ("holiday", "no_price_data")
        assert out["26-10-2026"][0] == "done"
        assert out["30-10-2026"][0] == "done"

    def test_outage_is_not_labelled_holiday(self):
        # Rate-limited: only 100 of 820 tickers returned anything.
        counts = {"26-10-2026": 100, "27-10-2026": 100, "28-10-2026": 0,
                  "29-10-2026": 100, "30-10-2026": 100}
        assert L.classify_ohlcv(self.DAYS, counts, 820, 100, self.NOW) == {}

    def test_total_failure_classifies_nothing(self):
        assert L.classify_ohlcv(self.DAYS, {}, 820, 0, self.NOW) == {}

    def test_thin_day_is_retried(self):
        counts = {"26-10-2026": 800, "27-10-2026": 300, "28-10-2026": 810,
                  "29-10-2026": 805, "30-10-2026": 800}
        out = L.classify_ohlcv(self.DAYS, counts, 820, 810, self.NOW)
        assert "27-10-2026" not in out

    def test_fresh_zero_day_not_holiday(self):
        counts = {"26-10-2026": 800, "27-10-2026": 800, "28-10-2026": 800,
                  "29-10-2026": 800, "30-10-2026": 0}
        sat = wib(2026, 10, 31, 10)
        out = L.classify_ohlcv(self.DAYS, counts, 820, 810, sat)
        assert "30-10-2026" not in out
        # ...but by Sunday the same zero is a real closure.
        out = L.classify_ohlcv(self.DAYS, counts, 820, 810, self.NOW)
        assert out["30-10-2026"][0] == "holiday"


class TestWarmup:
    def test_enough_history_short_overlap(self):
        assert L.warmup_start(date(2026, 1, 5), 250) == date(2026, 1, 2)

    def test_needs_warmup_goes_back_about_a_year(self):
        s = L.warmup_start(date(2026, 1, 5), 0)
        assert (date(2026, 1, 5) - s).days >= 294


class TestLock:
    def test_acquire_release(self, tmp_path):
        p = str(tmp_path / "c.lock")
        with L.FileLock(p):
            assert os.path.exists(p)
        assert not os.path.exists(p)

    def test_second_instance_refused(self, tmp_path):
        p = str(tmp_path / "c.lock")
        a = L.FileLock(p).acquire()
        try:
            with pytest.raises(L.LockHeld):
                L.FileLock(p).acquire()
        finally:
            a.release()

    def test_dead_pid_lock_is_taken_over(self, tmp_path):
        p = tmp_path / "c.lock"
        p.write_text("99999999\n")
        with L.FileLock(str(p)):
            assert p.read_text().strip() == str(os.getpid())

    def test_garbage_lock_is_taken_over(self, tmp_path):
        p = tmp_path / "c.lock"
        p.write_text("not a pid")
        with L.FileLock(str(p)):
            pass

    def test_own_pid_is_alive_and_nonpositive_is_not(self):
        assert L.pid_alive(os.getpid())
        assert not L.pid_alive(0)
        assert not L.pid_alive(-5)

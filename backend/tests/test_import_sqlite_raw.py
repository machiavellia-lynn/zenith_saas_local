"""Row validation and conversion in ops/import_sqlite_raw.py (no database needed)."""
import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ops.import_sqlite_raw import TABLES, convert  # noqa: E402


def sqlite_row(table: str, **over):
    """A sqlite3.Row shaped like the old file, text-typed as it was stored there."""
    base = {
        "raw_messages": dict(
            message_id="638212", channel="bad", date="09-12-2025", time="11:14:40", tx_count="4",
            ticker="BWPT", price="172.0", gain_pct="-1.15", freq="275", value_raw="953Jt",
            value_numeric="953.0", avg_mf_raw="114.0Jt", avg_mf_numeric="114.0",
            mf_delta_raw="-862.1Jt", mf_delta_numeric="-862.1", vol_x="6.2", signal="🟢"),
        "raw_mf_messages": dict(
            message_id="700001", channel="mf_plus", date="02-03-2026", time="09:08:01", tx_count="1",
            ticker="JRPT", price="1165.0", gain_pct="-2.51", val_raw="375Jt", val_numeric="375.0",
            mf_raw="+105Jt", mf_numeric="105.0", mft_raw="+59Jt", mft_numeric="59.0",
            cm_delta_raw="-58Jt", cm_delta_numeric="-58.0", signal="🔴"),
    }[table]
    base.update(over)
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    cols = list(base)
    con.execute(f"CREATE TABLE t ({', '.join(cols)})")
    con.execute(f"INSERT INTO t VALUES ({', '.join('?' for _ in cols)})", list(base.values()))
    return con.execute("SELECT * FROM t").fetchone()


@pytest.mark.parametrize("table", sorted(TABLES))
def test_valid_row_converts_with_types(table):
    vals, why = convert(sqlite_row(table), TABLES[table])
    assert why is None
    names = [n for n, _ in TABLES[table]["cols"]]
    d = dict(zip(names, vals))
    assert isinstance(d["message_id"], int)
    assert isinstance(d["tx_count"], int)
    assert isinstance(d["price"], float)
    assert d["ticker"] in ("BWPT", "JRPT")


def test_float_looking_integers_are_accepted():
    vals, why = convert(sqlite_row("raw_messages", tx_count="4.0", freq="275.0"), TABLES["raw_messages"])
    assert why is None
    d = dict(zip((n for n, _ in TABLES["raw_messages"]["cols"]), vals))
    assert d["tx_count"] == 4 and d["freq"] == 275


def test_blank_numbers_become_null_not_zero():
    vals, why = convert(sqlite_row("raw_messages", freq="", vol_x=None), TABLES["raw_messages"])
    assert why is None
    d = dict(zip((n for n, _ in TABLES["raw_messages"]["cols"]), vals))
    assert d["freq"] is None and d["vol_x"] is None


def test_old_format_empty_signal_is_kept_as_is():
    vals, why = convert(sqlite_row("raw_messages", signal=""), TABLES["raw_messages"])
    assert why is None
    assert dict(zip((n for n, _ in TABLES["raw_messages"]["cols"]), vals))["signal"] == ""


@pytest.mark.parametrize("over,reason", [
    ({"date": "2025-12-09"}, "bad_date"),
    ({"date": ""}, "bad_date"),
    ({"date": None}, "bad_date"),
    ({"channel": "mf_plus"}, "bad_channel"),       # an MF channel in the SM/BM table
    ({"ticker": ""}, "missing_key"),
    ({"message_id": ""}, "missing_key"),
    ({"price": "abc"}, "unconvertible_value"),
])
def test_bad_rows_are_skipped_with_a_reason(over, reason):
    vals, why = convert(sqlite_row("raw_messages", **over), TABLES["raw_messages"])
    assert vals is None
    assert why == reason


def test_mf_table_rejects_sm_bm_channels():
    vals, why = convert(sqlite_row("raw_mf_messages", channel="smart"), TABLES["raw_mf_messages"])
    assert vals is None and why == "bad_channel"

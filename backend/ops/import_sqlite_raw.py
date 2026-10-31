"""
import_sqlite_raw.py — copy raw SM/BM and MF rows from an old Zenith SQLite file into
the local PostgreSQL, so history that Telegram no longer holds can be recovered.

    python ops/import_sqlite_raw.py --source D:\\zenith_saas_algo_dev\\zenith_local.db --dry-run
    python ops/import_sqlite_raw.py --source D:\\zenith_saas_algo_dev\\zenith_local.db

* The SQLite file is opened read-only (`mode=ro&immutable=1`); it is never written.
* Only `raw_messages` and `raw_mf_messages` are copied. Summaries, analytics and prices
  are rebuilt from them by ops/weekend_catchup.py, never copied: that keeps one price
  source (Yahoo) and one set of formulas.
* Rows are keyed by (message_id, ticker), as in PostgreSQL; a row already there is left
  alone, so re-running is safe.
* A row is skipped, and counted by reason, if its date is not DD-MM-YYYY, its channel is
  unexpected, or message_id / ticker is missing. Nothing is silently repaired.
"""
import argparse
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import psycopg2  # noqa: E402
from psycopg2.extras import execute_values  # noqa: E402

CHUNK = 20_000
DATE_RE = re.compile(r"^\d{2}-\d{2}-\d{4}$")

# column -> converter, in the order they are inserted (id is left to PostgreSQL)
def _int(v):
    return None if v in (None, "") else int(float(v))


def _float(v):
    return None if v in (None, "") else float(v)


def _text(v):
    return None if v is None else str(v)


TABLES = {
    "raw_messages": {
        "channels": {"smart", "bad"},
        "cols": [("message_id", _int), ("channel", _text), ("date", _text), ("time", _text),
                 ("tx_count", _int), ("ticker", _text), ("price", _float), ("gain_pct", _float),
                 ("freq", _int), ("value_raw", _text), ("value_numeric", _float),
                 ("avg_mf_raw", _text), ("avg_mf_numeric", _float), ("mf_delta_raw", _text),
                 ("mf_delta_numeric", _float), ("vol_x", _float), ("signal", _text)],
    },
    "raw_mf_messages": {
        "channels": {"mf_plus", "mf_minus"},
        "cols": [("message_id", _int), ("channel", _text), ("date", _text), ("time", _text),
                 ("tx_count", _int), ("ticker", _text), ("price", _float), ("gain_pct", _float),
                 ("val_raw", _text), ("val_numeric", _float), ("mf_raw", _text),
                 ("mf_numeric", _float), ("mft_raw", _text), ("mft_numeric", _float),
                 ("cm_delta_raw", _text), ("cm_delta_numeric", _float), ("signal", _text)],
    },
}


def convert(row, spec):
    """One SQLite row -> tuple for PostgreSQL, or (None, reason) when it must be skipped."""
    try:
        vals = [fn(row[name]) for name, fn in spec["cols"]]
    except (ValueError, TypeError):
        return None, "unconvertible_value"
    d = dict(zip((n for n, _ in spec["cols"]), vals))
    if d["message_id"] is None or not d["ticker"]:
        return None, "missing_key"
    if not d["date"] or not DATE_RE.match(d["date"]):
        return None, "bad_date"
    if d["channel"] not in spec["channels"]:
        return None, "bad_channel"
    return tuple(vals), None


def import_table(src, pg, table, dry_run):
    spec = TABLES[table]
    names = [n for n, _ in spec["cols"]]
    cur = pg.cursor()
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    before = cur.fetchone()[0]

    total = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    skipped = {}
    read = sent = 0
    t0 = time.time()
    sql = (f"INSERT INTO {table} ({', '.join(names)}) VALUES %s "
           f"ON CONFLICT (message_id, ticker) DO NOTHING")

    rows = src.execute(f"SELECT {', '.join(names)} FROM {table} ORDER BY id")
    while True:
        batch = rows.fetchmany(CHUNK)
        if not batch:
            break
        good = []
        for r in batch:
            read += 1
            vals, why = convert(r, spec)
            if why:
                skipped[why] = skipped.get(why, 0) + 1
            else:
                good.append(vals)
        sent += len(good)
        if good and not dry_run:
            execute_values(cur, sql, good, page_size=5000)
            pg.commit()
        if read % (CHUNK * 5) == 0:
            print(f"  {table}: {read:,}/{total:,} dibaca ({time.time() - t0:.0f}s)", flush=True)

    cur.execute(f"SELECT COUNT(*) FROM {table}")
    after = cur.fetchone()[0]
    print(f"{table}: dibaca={read:,} valid={sent:,} dilewati={sum(skipped.values()):,} {skipped or ''}")
    if dry_run:
        print(f"  [dry-run] tidak ada yang ditulis; baris di PostgreSQL tetap {before:,}")
    else:
        print(f"  baris di PostgreSQL: {before:,} -> {after:,} (+{after - before:,}); "
              f"sudah ada/duplikat: {sent - (after - before):,}")
    return {"read": read, "valid": sent, "skipped": skipped, "before": before, "after": after}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[1].strip())
    p.add_argument("--source", required=True, help="old Zenith SQLite file (opened read-only)")
    p.add_argument("--dry-run", action="store_true", help="validate and count; write nothing")
    p.add_argument("--only", choices=sorted(TABLES), help="copy a single table")
    a = p.parse_args(argv)

    if not os.path.isfile(a.source):
        print(f"file tidak ditemukan: {a.source}")
        return 4
    uri = "file:" + a.source.replace("\\", "/") + "?mode=ro&immutable=1"
    src = sqlite3.connect(uri, uri=True)
    src.row_factory = sqlite3.Row
    pg = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        for table in ([a.only] if a.only else list(TABLES)):
            import_table(src, pg, table, a.dry_run)
    finally:
        src.close()
        pg.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

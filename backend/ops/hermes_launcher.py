"""
hermes_launcher.py — thin launcher for `hermes cron create --no-agent --script`.

Hermes runs a --script with its own interpreter, which has no telethon/psycopg2.
This file therefore only starts weekend_catchup.py with the system Python and
passes its stdout through verbatim. Hermes delivers stdout as-is and treats an
EMPTY stdout as "nothing to report", so a quiet tick stays quiet.

Python interpreter, in order: $ZENITH_PYTHON, the system Python 3.12 install, then
whatever `python` is on PATH.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

CATCHUP = Path(r"D:\zenith_saas_local\backend\ops\weekend_catchup.py")
SYSTEM_PY = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python312" / "python.exe"


def pick_python() -> str:
    for cand in (os.environ.get("ZENITH_PYTHON"), str(SYSTEM_PY), shutil.which("python")):
        if cand and Path(cand).exists():
            return cand
    return "python"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    try:
        r = subprocess.run(
            [pick_python(), str(CATCHUP), *sys.argv[1:]],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=env, cwd=str(CATCHUP.parent.parent), timeout=11 * 3600,
        )
    except subprocess.TimeoutExpired:
        print("weekend_catchup: melebihi 11 jam, dihentikan (lihat ops/state/catchup.log)")
        return 1
    if r.stdout.strip():
        print(r.stdout.rstrip())
    elif r.returncode not in (0,):
        # Failed without saying why (e.g. crashed on import): don't stay silent.
        tail = (r.stderr or "").strip().splitlines()[-3:]
        print(f"weekend_catchup exit={r.returncode} tanpa output. " + " | ".join(tail))
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())

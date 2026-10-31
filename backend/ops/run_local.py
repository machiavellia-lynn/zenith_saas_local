"""
run_local.py — serve the Zenith API on this laptop for the local frontend.

    python ops/run_local.py            # http://127.0.0.1:5000
    python ops/run_local.py --port 5050

Differences from `python app.py` (which is the production entry point):
  * listens on 127.0.0.1 only, never 0.0.0.0, and runs without the Werkzeug debugger;
  * the Telegram scraper thread and the Yahoo price-cache thread are NOT started
    (the catch-up job owns data collection; this process only reads the database).
    /api/ihsg is the one exception: it refreshes on demand, at most every 2 minutes;
  * it never alters the schema (the catch-up job owns that), so it is safe to start
    while a catch-up is running;
  * every request is treated as a logged-in local admin — safe only because the
    socket is bound to loopback. Do not change --host to a LAN address;
  * CORS is limited to the Vite dev/preview origins below (loopback host + port
    range, exact match, no wildcard).
"""
import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from dotenv import load_dotenv  # noqa: E402

# Before anything imports config: config reads the environment at import time.
load_dotenv(ROOT / ".env")

os.environ["SCRAPER_ENABLED"] = "0"
os.environ.setdefault("SESSION_DIR", str(ROOT / "ops" / "state" / "sessions"))

IHSG_RETRY_S = 120

# Vite dev starts at 5173 and preview at 4173; either steps up to the next free
# port when its own is taken, so allow a short range above each. Exact origins
# only: loopback hosts, no wildcard host, no other ports.
ALLOWED_ORIGINS = {
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (*range(5173, 5190), *range(4173, 4190))
}


def _lazy_ihsg():
    """Make /api/ihsg work without the price-cache thread.

    The cache is only ever filled by the thread we disabled, so refresh it on
    demand instead: at most one Yahoo call per IHSG_RETRY_S, whether or not the
    last one succeeded (a failed fetch must not turn every request into a 5 s wait).
    """
    import time
    import data.price_cache as pc

    original = pc.get_cached_ihsg
    state = {"last_try": 0.0}

    def get_cached_ihsg():
        now = time.monotonic()
        if now - state["last_try"] >= IHSG_RETRY_S:
            state["last_try"] = now
            pc._refresh_ihsg()
        return original()

    pc.get_cached_ihsg = get_cached_ihsg


def build_app():
    import startup
    startup._start_scraper = lambda: None
    startup._start_price_cache = lambda: None
    # This process only reads. The schema is ensured by ops/weekend_catchup.py, and
    # running its ALTER TABLEs here queues behind a running catch-up's locks and then
    # blocks that catch-up's own writes in turn.
    startup._init_schema = lambda: None
    _lazy_ihsg()

    from flask import request, session
    from app import app

    @app.before_request
    def _local_admin():
        session["authed"] = True
        session["user"] = "local"
        session["role"] = "admin"

    @app.after_request
    def _cors(resp):
        origin = request.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        return resp

    return app


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[1].strip())
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5000)
    a = p.parse_args(argv)
    if a.host not in ("127.0.0.1", "localhost"):
        p.error("refusing to bind a non-loopback host: every request is auto-logged-in as admin")
    app = build_app()
    app.run(host=a.host, port=a.port, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()

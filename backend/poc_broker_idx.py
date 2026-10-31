"""
poc_broker_idx.py — IDX Broker Data POC
Tests IDX unofficial endpoints to understand available broker data.
Run: python poc_broker_idx.py
"""
import json
from curl_cffi import requests

BASE_URL = "https://www.idx.co.id/primary"

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "id-ID,id;q=0.9,en;q=0.8",
    "origin": "https://www.idx.co.id",
}

def fetch(endpoint, params=None, referrer="https://www.idx.co.id/"):
    url = f"{BASE_URL}{endpoint}"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{qs}"
    headers = {**HEADERS, "Referer": referrer}
    print(f"\n{'='*60}")
    print(f"GET {url}")
    try:
        r = requests.get(url, headers=headers, impersonate="chrome", timeout=15)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            return r.json()
        else:
            print(f"Body: {r.text[:300]}")
            return None
    except Exception as e:
        print(f"Error: {e}")
        return None

def show(data, label="", max_records=3):
    if not data:
        print("  → No data")
        return
    print(f"\n--- {label} ---")
    if isinstance(data, dict):
        keys = list(data.keys())
        print(f"Top-level keys: {keys}")
        # Common IDX pagination wrapper
        for key in ["Data", "data", "Results", "results"]:
            if key in data:
                records = data[key]
                print(f"data['{key}'] = {len(records)} records")
                if records:
                    print(f"Fields: {list(records[0].keys())}")
                    for r in records[:max_records]:
                        print(json.dumps(r, ensure_ascii=False, indent=2))
                return
        # No pagination wrapper — dump raw
        print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
    elif isinstance(data, list):
        print(f"{len(data)} records")
        if data:
            print(f"Fields: {list(data[0].keys())}")
            for r in data[:max_records]:
                print(json.dumps(r, ensure_ascii=False, indent=2))


# ── 1. GetBrokerSummary (aggregate — all stocks) ──────────────────────────────
print("\n" + "="*60)
print("TEST 1: GetBrokerSummary — aggregate (all stocks, one date)")
data = fetch(
    "/TradingSummary/GetBrokerSummary",
    params={"date": "20260619", "start": 0, "length": 5},
    referrer="https://www.idx.co.id/en/market-data/trading-summary/broker-summary/"
)
show(data, "GetBrokerSummary (date=20260619, length=5)")

# ── 2. GetBrokerSummary with stock filter (does it exist?) ───────────────────
print("\n" + "="*60)
print("TEST 2: GetBrokerSummary — with stock=BBCA filter")
data2 = fetch(
    "/TradingSummary/GetBrokerSummary",
    params={"date": "20260619", "start": 0, "length": 5, "stock": "BBCA"},
    referrer="https://www.idx.co.id/en/market-data/trading-summary/broker-summary/"
)
show(data2, "GetBrokerSummary stock=BBCA")

# ── 3. GetStockSummary — per-stock aggregate (to see structure) ───────────────
print("\n" + "="*60)
print("TEST 3: GetStockSummary — per-stock aggregate")
data3 = fetch(
    "/TradingSummary/GetStockSummary",
    params={"date": "20260619", "start": 0, "length": 3},
    referrer="https://www.idx.co.id/en/market-data/trading-summary/stock-summary/"
)
show(data3, "GetStockSummary (date=20260619)")

# ── 4. GetBrokerSearch — list of all brokers ──────────────────────────────────
print("\n" + "="*60)
print("TEST 4: GetBrokerSearch — list semua broker")
data4 = fetch(
    "/ExchangeMember/GetBrokerSearch",
    params={"option": 0, "license": "", "start": 0, "length": 5},
    referrer="https://www.idx.co.id/id/members-and-participants/exchange-member-directory/"
)
show(data4, "GetBrokerSearch (length=5)")

# ── 5. GetMkbdSummary — broker activity summary (per broker?) ────────────────
print("\n" + "="*60)
print("TEST 5: GetMkbdSummary — detail aktivitas broker XL (Stockbit)")
data5 = fetch(
    "/ExchangeMember/GetMkbdSummary",
    params={"code": "XL"},
    referrer="https://www.idx.co.id/id/members-and-participants/exchange-member-directory/"
)
show(data5, "GetMkbdSummary code=XL")

# ── 6. GetBrokerDetail ────────────────────────────────────────────────────────
print("\n" + "="*60)
print("TEST 6: GetBrokerDetail code=XL")
data6 = fetch(
    "/ExchangeMember/GetBrokerDetail",
    params={"code": "XL"},
    referrer="https://www.idx.co.id/id/members-and-participants/exchange-member-directory/"
)
show(data6, "GetBrokerDetail code=XL")

# ── 7. GetPedSummary — investor type (domestic/foreign) breakdown ─────────────
print("\n" + "="*60)
print("TEST 7: GetPedSummary — foreign vs domestic investor breakdown")
data7 = fetch(
    "/TradingSummary/GetPedSummary",
    params={"date": "20260619", "start": 0, "length": 3},
    referrer="https://www.idx.co.id/en/market-data/trading-summary/ped-summary/"
)
show(data7, "GetPedSummary (date=20260619)")

print("\n\nDone.")

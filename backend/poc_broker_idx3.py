"""
poc_broker_idx3.py — Cari per-stock per-broker endpoint IDX
IDX website menampilkan broker activity di halaman saham — endpoint-nya pasti ada.
"""
from curl_cffi import requests
import json

BASE = "https://www.idx.co.id/primary"
HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "id-ID,id;q=0.9,en;q=0.8",
    "Referer": "https://www.idx.co.id/",
}

def fetch(url, label):
    print(f"\n### {label}")
    print(f"  {url}")
    try:
        r = requests.get(url, headers=HEADERS, impersonate="chrome", timeout=12)
        print(f"  Status: {r.status_code}", end="")
        if r.status_code == 200:
            ct = r.headers.get("content-type", "")
            if "json" in ct:
                d = r.json()
                if isinstance(d, list) and d:
                    print(f" | List({len(d)}) | Keys: {list(d[0].keys())}")
                    print(f"  Sample: {json.dumps(d[0], ensure_ascii=False)[:200]}")
                elif isinstance(d, dict):
                    print(f" | Dict | Keys: {list(d.keys())}")
                    for k in ["Data","data","Results","results","Items","items"]:
                        if k in d and d[k]:
                            recs = d[k]
                            print(f"  [{k}]({len(recs)}) Keys: {list(recs[0].keys()) if recs else []}")
                            if recs: print(f"  Sample: {json.dumps(recs[0], ensure_ascii=False)[:250]}")
                            break
                    else:
                        print(f"  {json.dumps(d, ensure_ascii=False)[:300]}")
            else:
                print(f" | {ct[:40]} | {len(r.content)} bytes")
        elif r.status_code == 503:
            print(" | 503 (endpoint tidak ada)")
        else:
            print(f" | {r.text[:100]}")
    except Exception as e:
        print(f"\n  ERROR: {e}")

# Halaman IDX untuk detail saham menggunakan endpoint ini
# Coba variasi endpoint yang ada di IDX website untuk per-stock broker data
stock = "BBCA"
date  = "20260619"

# Grup 1: Variasi GetStockSummary dengan broker filter
fetch(f"{BASE}/TradingSummary/GetStockSummary?date={date}&broker=XL&start=0&length=5", "StockSummary + broker=XL")
fetch(f"{BASE}/TradingSummary/GetStockSummary?date={date}&IDFirm=XL&start=0&length=5", "StockSummary + IDFirm=XL")

# Grup 2: Coba endpoint khusus broker-saham
fetch(f"{BASE}/TradingSummary/GetTopBroker?date={date}&stock={stock}&start=0&length=5", "GetTopBroker")
fetch(f"{BASE}/TradingSummary/GetTopBrokerByStock?date={date}&stock={stock}&start=0&length=5", "GetTopBrokerByStock")
fetch(f"{BASE}/TradingSummary/GetBrokerByStock?date={date}&stock={stock}&start=0&length=5", "GetBrokerByStock")
fetch(f"{BASE}/TradingSummary/GetNetBuySell?date={date}&start=0&length=5", "GetNetBuySell")
fetch(f"{BASE}/TradingSummary/GetNetBuySellBroker?date={date}&start=0&length=5", "GetNetBuySellBroker")
fetch(f"{BASE}/TradingSummary/GetBrokerTransaction?date={date}&stock={stock}&start=0&length=5", "GetBrokerTransaction")

# Grup 3: MarketData endpoints
fetch(f"{BASE}/MarketData/GetBrokerStock?date={date}&broker=XL&start=0&length=5", "MarketData/GetBrokerStock")
fetch(f"{BASE}/MarketData/GetStockBroker?date={date}&stock={stock}&start=0&length=5", "MarketData/GetStockBroker")
fetch(f"{BASE}/MarketData/GetNetTransaction?date={date}&broker=XL&start=0&length=5", "MarketData/GetNetTransaction")

# Grup 4: IDX punya endpoint untuk company trading activity
fetch(f"{BASE}/ListedCompany/GetTradingActivity?kodeEmiten={stock}&date={date}", "ListedCompany/GetTradingActivity")
fetch(f"{BASE}/ListedCompany/GetBrokerActivity?kodeEmiten={stock}&date={date}", "ListedCompany/GetBrokerActivity")
fetch(f"{BASE}/ListedCompany/GetStockTrading?KodeEmiten={stock}&date={date}", "ListedCompany/GetStockTrading")

# Grup 5: StockFinder — IDX punya fitur ini di website
fetch(f"{BASE}/StockFinder/GetBrokerStock?date={date}&stock={stock}&start=0&length=5", "StockFinder/GetBrokerStock")
fetch(f"{BASE}/StockFinder/GetTopBuyer?date={date}&stock={stock}&start=0&length=5", "StockFinder/GetTopBuyer")

# Grup 6: Cek apakah ada tipe statistik lain selain daily/monthly
fetch(f"{BASE}/Statistic/GetStatistic?year=2026&type=broker&lang=id", "Statistic type=broker")
fetch(f"{BASE}/Statistic/GetStatistic?year=2026&type=weekly&lang=id", "Statistic type=weekly")
fetch(f"{BASE}/Statistic/GetStatistic?year=2026&type=annual&lang=id", "Statistic type=annual")

print("\nDone.")

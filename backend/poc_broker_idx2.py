"""poc_broker_idx2.py — Investigate IDX statistical files"""
from curl_cffi import requests
import json, io, zipfile

HEADERS = {"accept": "application/json, text/plain, */*", "Referer": "https://www.idx.co.id/"}

# Step 1: Get daily stat file list
r = requests.get(
    "https://www.idx.co.id/primary/Statistic/GetStatistic?year=2026&type=daily&lang=id",
    headers=HEADERS, impersonate="chrome", timeout=15
)
items = r.json()
print(f"Total daily stat files in 2026: {len(items)}")
print()

for item in items[:8]:
    desc = item.get("description", "")[:70]
    file_url = item.get("file", "")
    date = item.get("date", "")
    num = item.get("number", "")
    print(f"  [{num}] {date} | {desc}")
    print(f"         {file_url[:100]}")

print("\n--- All descriptions ---")
for item in items:
    print(f"  {item.get('number','')}: {item.get('description','')}")

# Step 2: Try to download the most recent file
print("\n\n=== Trying to download most recent daily stat file ===")
# Get last item (most recent)
last = items[-1] if items else None
if last:
    file_url = last.get("file", "")
    print(f"File URL: {file_url}")
    if file_url:
        full_url = f"https://www.idx.co.id{file_url}" if file_url.startswith("/") else file_url
        print(f"Downloading: {full_url}")
        r2 = requests.get(full_url, headers=HEADERS, impersonate="chrome", timeout=30)
        print(f"Status: {r2.status_code} | Content-Type: {r2.headers.get('content-type','')}")
        print(f"Content-Length: {len(r2.content)} bytes")

        # If ZIP, peek inside
        if r2.status_code == 200:
            ct = r2.headers.get("content-type", "")
            if "zip" in ct or file_url.lower().endswith(".zip"):
                try:
                    zf = zipfile.ZipFile(io.BytesIO(r2.content))
                    print(f"\nZIP contents ({len(zf.namelist())} files):")
                    for name in zf.namelist():
                        info = zf.getinfo(name)
                        print(f"  {name} ({info.file_size:,} bytes)")
                except Exception as e:
                    print(f"ZIP error: {e}")
                    print("First 200 bytes (hex):", r2.content[:200].hex())
            else:
                # Maybe it's XLS/CSV
                print("First 500 chars:", r2.text[:500])

# Step 3: Also check monthly
print("\n\n=== Monthly stat files ===")
r3 = requests.get(
    "https://www.idx.co.id/primary/Statistic/GetStatistic?year=2026&type=monthly&lang=id",
    headers=HEADERS, impersonate="chrome", timeout=15
)
monthly = r3.json()
for item in monthly[:5]:
    print(f"  {item.get('number','')}: {item.get('description','')[:60]}")
    print(f"    file: {item.get('file','')[:100]}")

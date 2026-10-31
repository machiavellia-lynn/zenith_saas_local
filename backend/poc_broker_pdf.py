"""
poc_broker_pdf.py — Parse IDX Daily Statistics PDF
Cek apakah PDF punya tabel broker per saham.
"""
import io, pdfplumber
from curl_cffi import requests

HEADERS = {"accept": "*/*", "Referer": "https://www.idx.co.id/"}

# Download PDF terbaru (19 Jun 2026)
url = "https://www.idx.co.id/Media/huxmvyrd/ds_260619.pdf"
print(f"Downloading {url} ...")
r = requests.get(url, headers=HEADERS, impersonate="chrome", timeout=30)
print(f"Status: {r.status_code} | Size: {len(r.content)/1024:.0f} KB")

pdf_bytes = io.BytesIO(r.content)

with pdfplumber.open(pdf_bytes) as pdf:
    total = len(pdf.pages)
    print(f"Total pages: {total}\n")

    # Scan SEMUA halaman — cari tabel yang ada kolom broker/saham
    for i, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        tables = page.extract_tables()

        # Print judul/header setiap halaman
        first_line = text.strip().split("\n")[0][:80] if text.strip() else "(no text)"
        print(f"[Page {i+1:02d}] {first_line}")
        if tables:
            print(f"         -> {len(tables)} tabel")
            for j, tbl in enumerate(tables):
                if tbl and len(tbl) > 0:
                    header = tbl[0]
                    print(f"            Tbl[{j}] headers: {header}")
                    if len(tbl) > 1:
                        print(f"            Tbl[{j}] row1:    {tbl[1]}")

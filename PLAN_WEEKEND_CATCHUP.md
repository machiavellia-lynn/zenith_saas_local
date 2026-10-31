# Zenith SaaS Local — Rencana "Weekend Catch-up" di Laptop

> Dokumen kerja untuk Claude Code (dan nanti Hermes). Ditulis 2026-10-24.
> Status: **DIIMPLEMENTASI 2026-10-30 di `D:\zenith_saas_local\backend`** (DataSectors dibuang, BSJP dinonaktifkan). Yang tersisa: login Telegram OTP, backfill pertama, pendaftaran cron — lihat `TODO_NEXT.md` dan `backend/HERMES_GUIDE.md`. Bagian di bawah adalah rencana asli + revisi; bila berbeda dari kode, **kode menang**.
>
> Beda rencana vs implementasi: kuota DS tidak ada (diganti throttle Yahoo + percobaan ulang ≤3×); `--max-ds-requests` diganti `--only-tickers`/`--now`; tahap hilir mengikuti `catchup_day_status` dengan status `retry`; warm-up 354 hari kalender (bukan ±210 hari bursa polos) karena libur IDX; kode kerja ada di `backend/`, bukan `D:\zenith_saas` (yang dibiarkan read-only).
> Repo kode: `D:\zenith_saas` (jangan dipindah). Folder ini (`D:\zenith_saas_local`) hanya untuk catatan/rencana/artefak lokal.

---

## 1. Latar belakang & tujuan

Zenith SaaS sebelumnya live di VPS Linux (Railway/VPS) dan **dihentikan** karena relokasi biaya (tagihan belum dibayar, database lama tidak diambil).
Sekarang Zenith dijalankan di **laptop Windows pemilik**, **hanya akhir pekan (Sabtu/Minggu) saat laptop menyala**, dengan tujuan **enrich data saja** (bukan melayani web).

Tugas yang dulu berjalan setiap hari kerja di VPS:
1. Telegram listener realtime ke grup BST (topik SM, BM, MF+, MF-).
2. Hitung SM/BM/MF per emiten.
3. Algo: BSJP dan Wyckoff.

Yang dilakukan sekarang:
- **Tidak ada listener realtime.** Data Telegram dibaca dari riwayat grup (retroaktif).
- Sebuah script **catch-up** mengisi hanya hari bursa yang belum lengkap, lalu menghitung analitik + sinyal.
- Dipicu oleh **Hermes Agent** (cron `--no-agent`, tanpa LLM, tanpa token) tiap 30 menit; script keluar cepat bila tidak ada yang perlu dikerjakan.

## 2. Keputusan yang sudah disepakati

| # | Topik | Keputusan |
|---|-------|-----------|
| 1 | Database | **PostgreSQL baru dari nol di laptop**, backfill penuh. Kehilangan data beberapa bulan awal diterima. |
| 2 | Sinyal | Hanya **catatan historis**, tidak perlu actionable. |
| 3 | Definisi "up to date" | Dicek per hari bursa & per tahap (bukan sekadar tanggal terakhir). Sabtu sudah backfill → Minggu tidak mengulang. |
| 4 | Sumber harga | ~~DataSectors~~ **DIBUANG (2026-10-30).** OHLCV harian = **Yahoo** (`fetch_daily_yahoo`, throttle + resume per hari). Candle 15m **tidak diambil** karena hanya dipakai BSJP. |
| 4b | Algo BSJP | **Dinonaktifkan** di alur catch-up (kode tetap utuh, tidak dihapus). Tahap `m15`, `bsjp_scan`, `bsjp_result` dilewati lewat flag, bukan dihapus. Mengaktifkan lagi nanti = ubah satu flag + sumber 15m. |
| 5 | Web Flask | **Tidak dijalankan.** Laptop hanya enrich data. |
| 6 | Jadwal | **Sabtu & Minggu saja** (WIB). Mode `--force` untuk uji manual. |
| 7 | Hasil BSJP | **Disimpan ke database** (`bsjp_results`), bukan hanya sinyal. |
| 8 | Telegram | **Akun Telegram baru** → session baru, login OTP interaktif sekali. Akun harus sudah join grup BST. |
| 9 | Rentang backfill | **Seluruh riwayat Telegram yang masih ada.** OHLCV harian ditarik mundur ±210 hari bursa sebelum tanggal pertama (untuk MA200). |
| 10 | Pemasangan PostgreSQL | **Pemilik install sendiri.** |
| 11 | Perubahan kode | **Minimal** pada kode lama; fungsi lama dipanggil sebagai building block. |
| 12 | Dokumen akhir | Setelah rampung: buat file `.md` terperinci untuk dibaca Hermes. |

### Belum diputuskan
- ~~**Corporate action (split/rights):** DB baru kehilangan daftar `corporate_events`. Usul: isi otomatis dari endpoint splits/dividends DataSectors saat backfill awal sebagai status `suspected`, ditinjau pemilik sebelum `confirmed`; detektor otomatis (`detect_back_adjustments`) tetap dijalankan setelah catch-up. **Menunggu jawaban pemilik.**~~ **GUGUR (2026-10-30):** sumber splits = DataSectors yang dibuang; tidak ada pengisian `suspected`. Detektor lama (`detect_back_adjustments`) tetap dijalankan apa adanya.
- **Izin mulai implementasi:** belum diberikan.

## 3. Hal yang sudah diverifikasi di laptop (2026-10-24)

- Hermes: `%LOCALAPPDATA%\hermes` (`hermes.exe` di `...\hermes\bin`). Gateway start otomatis saat login (Startup: `Hermes_Gateway.vbs`). Punya `hermes cron` dengan opsi `--no-agent --script <path di ~/.hermes/scripts/>`; `--interpreter` tersedia. Cron berbasis jam, **bukan** "on boot".
- 6 job LLM Hermes yang ada sedang gagal (HTTP 402, free trial provider habis) — tidak terkait Zenith.
- PostgreSQL: **belum terpasang** (tidak ada service/psql/Docker) — pemilik akan memasang.
- Python sistem 3.12 punya: flask, psycopg2, telethon, bcrypt, requests, python-dotenv, gunicorn.
- Timezone laptop: Taipei (UTC+8). Kode memakai WIB eksplisit (`config.WIB`) → aman; aturan "hari selesai" dihitung dalam WIB.

## 4. Arsitektur kode yang relevan (ringkas)

Pipeline per tanggal (format tanggal: `eod_summary`/`raw_*` = `DD-MM-YYYY`; `price_history`/`price_history_15m` = `YYYY-MM-DD`):

```
Telegram (riwayat) -> parse_joker_message/parse_mf_message -> save_sm_bm_rows/save_mf_rows
   -> raw_messages / raw_mf_messages (+ ticker_universe)
   -> rebuild_summary_for_date  -> eod_summary (flow)
OHLCV harian (DataSectors) -> price_history
   -> seed_eod_from_price_history (semua ticker aktif) -> sync_eod_prices_from_history
   -> compute_analytics_for_date -> eod_summary (SRI/phase/action/narrative/MA/BB...)
   -> compute_bsjp_for_date      -> price_history (19 kolom indikator BSJP)
15m (DataSectors) -> price_history_15m
   -> run_bsjp_scan(date, defer_pricing=False) -> bsjp_signals (universe 'full' & 'syariah', TOP_N=5)
   -> (hasil exit T+1) eval_exit_15m -> bsjp_results   [BARU: belum ada penulisnya]
```

Fungsi lama yang dipakai ulang (modul): `core.db_schema.ensure_schema`, `scraper.scraper_parser`, `scraper.scraper_saver`, `algo.summary_rebuild`, `data.price_fetch.fetch_daily_datasectors` / `fetch_intraday_15m_datasectors`, `algo.analytics_daily`, `algo.analytics_bsjp`, `scraper.scraper_daily.run_bsjp_scan`, `algo.algo_bsjp.eval_exit_15m`, `algo.corporate_actions`.

**Jangan dipakai apa adanya:** `run_weekly_backfill` (memanggil Yahoo di tengah jalan lewat `backfill_prices`) dan `app.py`/`startup.py` (menyalakan daemon + jadwal jam-jaman + `price_cache`).

## 5. Yang NON-AKTIF dalam mode laptop (selain listener realtime)

**Mati total (web & daemon tidak jalan)**
- Flask + 9 blueprint: login/auth, halaman flow/chart/sector/wyckoff/bsjp/portfolio, `/api/v1/*`, `/api/public/performance`, seluruh admin panel. Situs portofolio eksternal yang memakai API itu ikut mati.
- Thread `price_cache` (IHSG + harga live 30 dtk), `TTLCache`.
- Request-queue dari admin (backfill/rebuild/recompute/fix-all/tele-dates).
- `_seed_admin`, lock `/tmp/zenith2_scraper.lock`.

**Jadwal harian yang digantikan proses berbasis rentang tanggal**
- Pass 12:10 / 15:30 / 16:30 (`run_backfill`, hanya "hari ini").
- Prefetch 15m 12:30, enrich kandidat 15:46.
- Scan BSJP live 15:48 (`defer_pricing=True`) dan pricing pass 16:45 (historis dihitung langsung).
- Koreksi DataSectors Minggu 02:00 & maintenance Senin 03:00.
- Backtest malam / backtest BSJP / simulasi portfolio (cache memori saja, tanpa persistensi → tanpa web tidak berguna).
- Detektor CA malam → diganti langkah eksplisit setelah catch-up.

**Memang tidak pernah aktif sebelumnya**
- ARJUM broksum (`data/broksum_fetch.py`), placeholder `ds_*`, tabel `ohlcv_cache` / `inst_flow_cache` / `backtest_cache`.
- `trade_journal` (tabel & kode tidak ada di tree utama; `/api/v1/trade-journal` akan error — web mati, abaikan).
- `bsjp_results` (tabel ada, **tidak ada kode penulis** → akan dibuat di rencana ini).

## 6. Rancangan komponen baru

### 6.1 `ops/weekend_catchup.py` (entry point tunggal)
- Muat `.env` (python-dotenv), paksa stdout/log UTF-8 (konsol Windows locale Taiwan cp950 bisa error pada emoji di log).
- **Gerbang hari:** hanya Sabtu/Minggu WIB, kecuali `--force`.
- **Lock satu-instance** (file di folder proyek, berisi PID, bersihkan jika PID mati) — backfill awal bisa berjam-jam sementara cron memicu tiap 30 menit.
- **Hari yang diproses:** hanya hari bursa **selesai**: tanggal < hari ini (WIB), atau hari ini setelah ≈17:00 WIB.
- **Celah dihitung umum** (bukan jendela 7 hari): semua hari kerja sejak awal rentang yang tahapnya belum `done`.
- Mode: `--status` (ringkasan per tahap), `--dry-run` (tampilkan rencana tanpa menulis/memanggil API), `--force`, `--from/--to` (batasi rentang), `--max-ds-requests` (anggaran harian).
- Exit code & log ringkas; stdout kosong bila tidak ada pekerjaan (cocok dengan semantik Hermes `--no-agent`: stdout kosong = diam).

### 6.2 Tabel baru `catchup_day_status` (di `core/db_schema.py`; satu-satunya perubahan skema)
```
catchup_day_status(
  date        TEXT NOT NULL,      -- DD-MM-YYYY (konsisten dengan eod_summary)
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL,      -- done | holiday | skipped
  detail      TEXT,
  done_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, stage)
)
```
Alasan: hari tanpa sinyal BSJP tidak bisa dibedakan dari hari belum diproses jika hanya melihat isi tabel; marker per tahap menjamin idempotensi (Sabtu lalu Minggu tidak mengulang).

### 6.3 Tahap per tanggal (WAJIB urut kronologis)
SRI/ATR/MA200 bergantung pada riwayat → analitik hari D hanya boleh dihitung setelah data hari < D lengkap.

| Stage | Isi | Sumber/Fungsi |
|-------|-----|---------------|
| `telegram` | Baca riwayat 4 topik untuk tanggal target → `raw_*` | `parse_*`, `save_*` (iter_messages, stop saat lewat jendela) |
| `summary` | Agregasi flow | `rebuild_summary_for_date` |
| `daily_ohlcv` | OHLCV harian semua ticker aktif | `fetch_daily_datasectors` (1 request/ticker/rentang) |
| `seed_sync` | Seed eod_summary semua ticker + sync price_close | `seed_eod_from_price_history`, `sync_eod_prices_from_history` |
| `analytics` | Wyckoff + MA/RSI/BB | `compute_analytics_for_date` |
| `bsjp_ind` | 19 indikator BSJP | `compute_bsjp_for_date` |
| `m15` | Candle 15m semua ticker aktif | `fetch_intraday_15m_datasectors` |
| `bsjp_scan` | Sinyal (full + syariah) | `run_bsjp_scan(conn, date, defer_pricing=False)` |
| `bsjp_result` | Hasil exit sinyal tanggal T memakai 15m T+1 → `bsjp_results` | fungsi baru + `eval_exit_15m` |

Catatan penting:
- **Hasil BSJP selalu telat 1 hari bursa**: hasil sinyal Jumat baru bisa dihitung setelah candle Senin ada (weekend berikutnya). Normal.
- **Hari libur** = hari kerja tanpa satu pun candle dari DataSectors → tahap ditandai `holiday`, tidak diulang.
- **Warm-up MA200:** ambil OHLCV harian mulai ≈210 hari bursa sebelum tanggal Telegram pertama (kedalaman DataSectors **harus diuji**).
- **15m:** BSJP hanya bisa menghasilkan sinyal untuk tanggal yang punya candle 15:45 **dan** 09:00. Kedalaman historis 15m DataSectors **harus diuji**; bila terbatas, catatan BSJP mulai dari tanggal tertentu saja.
- Tahap `daily_ohlcv` & `m15` bisa dibatch per rentang (1 request/ticker meliputi banyak hari) — hemat kuota.

### 6.4 Anggaran & resume kuota DataSectors
- Kuota 5.000/hari; rate 1 req/detik (sudah ditegakkan di fungsi fetch). Perkiraan: backfill awal ±1.600–3.000+ request (bisa melebihi 1 hari), lalu ±1.600/minggu (800 harian + 800 untuk 15m).
- Script mencatat penggunaan per hari (WIB) dan berhenti rapi di batas (default ≈4.500); lanjut di sesi berikutnya tanpa mengulang tahap `done`.

### 6.5 Hasil exit BSJP → `bsjp_results`
- Fungsi baru kecil: untuk tiap sinyal (date, ticker) yang belum punya hasil dan punya candle 15m hari bursa berikutnya → `eval_exit_15m(entry, tp1, tp2, sl, candles)` → upsert `bsjp_results(date, ticker, exit_price, status, reason, exit_time, pnl)`.
- Catatan skema: `bsjp_results` UNIQUE(date, ticker) tanpa kolom universe (hasil sama untuk universe mana pun). Ticker yang sinyalnya hanya di `syariah` juga dihitung.

### 6.6 Penyesuaian Windows (tanpa mengubah perilaku Linux)
- Path lock / session / Telegram lewat env + default berbasis `os.name`.
- Logging UTF-8.
- `malloc_trim`/`MALLOC_*` otomatis no-op di Windows.
- Waktu: selalu `config.WIB`.

### 6.7 Telegram login (sekali, interaktif)
- `ops/tg_login.py`: membuat file session baru memakai API ID/HASH; pemilik menjalankan lewat `! python ops/tg_login.py` agar OTP masuk.
- Prasyarat: akun baru sudah join grup BST dan melihat 4 topik (`TG_GROUP_ID=-1002717915373`, topik 192528 / 219042 / 1025256 / 1025260).
- Pastikan VPS lama benar-benar mati (hindari `AuthKeyDuplicated` bila session lama dipakai).

### 6.8 Corporate action
- Setelah backfill awal: `detect_back_adjustments` + (usul) isi `suspected` dari endpoint splits DataSectors. Status `confirmed` hanya oleh keputusan pemilik. Hanya `confirmed` yang mengeluarkan ticker dari Portfolio/BSJP.
- Catatan: detektor hanya melihat 20 hari terakhir dan membandingkan `eod_summary` vs `price_history` → pada DB baru dengan data DataSectors (tak ter-adjust), keduanya sama → tidak akan terflag. Karena itu sumber endpoint splits dibutuhkan.

### 6.9 Pemicu Hermes
```
hermes cron create "every 30m" --no-agent --script <launcher .py di ~/.hermes/scripts/> --name "Zenith weekend catch-up" --deliver local
```
Launcher tipis: memanggil `python D:\zenith_saas\ops\weekend_catchup.py` dengan interpreter Python 3.12 sistem (atau `--interpreter`). Cron tidak jalan saat laptop mati; saat menyala, tick berikutnya mengejar.

## 7. Variabel lingkungan (`D:\zenith_saas\.env`, jangan dicommit)

| Variabel | Keterangan |
|----------|------------|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/zenith` |
| `DATASECTORS_API_KEY` | ~~wajib~~ **tidak dipakai** |
| `BSJP_ENABLED` | baru, default `0`. Tahap `m15`/`bsjp_scan`/`bsjp_result` hanya jalan bila `1` |
| `TG_API_ID`, `TG_API_HASH` | **sudah diisi** di `.env` (2026-10-30) |
| `TG_SESSION_PATH` | path Windows tanpa suffix `.session` |
| `FLASK_SECRET` | `config.py` mengimpor; boleh nilai acak (web tidak jalan) |
| `SCRAPER_ENABLED` | tidak dipakai oleh script CLI |
| `ARJUM_API_KEY` | opsional, tidak dipakai |

## 8. Urutan kerja yang direncanakan

0. Pemilik: install PostgreSQL, buat DB `zenith`, isi `.env`, buat session Telegram (6.7).
1. Smoke test koneksi: `ensure_schema` ke DB kosong; test DataSectors (kuota, kedalaman daily & 15m, header rate-limit); test Telegram (baca 4 topik).
2. Implementasi `catchup_day_status`, `ops/weekend_catchup.py`, penulis `bsjp_results`, penyesuaian Windows.
3. Tes unit (deteksi celah, idempotensi, urutan kronologis, gerbang hari, lock) dengan data buatan.
4. Uji ujung-ke-ujung di DB sementara dengan rentang kecil (±3–5 hari bursa); validasi hasil vs logika lama.
5. Backfill penuh bertahap (menghormati anggaran kuota), pantau dengan `--status`.
6. Corporate action: isi `suspected`, tinjau bersama pemilik.
7. Daftarkan cron Hermes (`--no-agent`).
8. Tulis `HERMES_GUIDE.md` (arsitektur, cara jalan, baca status, troubleshooting, batasan).

## 9. Risiko & catatan teknis yang sudah ditemukan

- **Kredensial bocor di dokumen repo:** `ZENITH_HANDOFF_v4.md` dan `structure/ZENITH_HANDOFF_v5.md` memuat `TG_API_HASH`/`TG_API_ID` lama, `ACCESS_KEY`, `UPLOAD_SECRET`. Akun Telegram baru mengurangi risiko, tetapi tetap sebaiknya dibersihkan/dirotasi.
- Bug ditemukan (di luar lingkup, hanya dicatat): `/api/v1/price-history` memakai format tanggal salah; `/api/v1/trade-journal` tanpa tabel; 1 test gagal (`test_volx_gap_none_when_no_price`); gerbang `first_pass` memakai `hour>=15 and minute>=30`; dokumen vs kode berbeda (Gate A 3.0× vs 1.1×, trimmed mean vs mean biasa, top-15 vs top-5).
- `TOP_N_BSJP` ada di dua tempat (`scraper_daily.py` dan `algo_backtest.py`); harus sama.
- `FLASK_SECRET` default lemah (`zenith-secret-key-dev`) — tidak relevan jika web tidak jalan.
- Impor `scraper.scraper_daily` membawa modul backtest/portfolio (tanpa efek samping selain handler logging); aman untuk dipakai script.
- Memori: tidak ada persistensi backtest/portfolio — keputusan: tidak dipertahankan di mode laptop.

## 9b. Dampak pembuangan DataSectors (2026-10-30)

- Tahap aktif: `telegram`, `summary`, `daily_ohlcv` (Yahoo), `seed_sync`, `analytics`, `bsjp_ind`. `bsjp_ind` tetap jalan karena hanya memakai OHLCV harian (cek saat implementasi).
- Tahap nonaktif (flag `BSJP_ENABLED=0`): `m15`, `bsjp_scan`, `bsjp_result`. Tabel `bsjp_signals`/`bsjp_results` tetap ada, kosong.
- Anggaran kuota DS (6.4) tidak berlaku. Gantinya: throttle Yahoo + resume per hari lewat `catchup_day_status`.
- Risiko Yahoo: rate-limit; harga bisa sudah ter-adjust corporate action, dan tanpa sumber splits detektor lama tidak akan menangkapnya (6.8). Dicatat sebagai keterbatasan yang diterima.
- Kode DataSectors (`price_datasectors.py`, `ds_*`, 92 referensi di 17 file) **tidak dihapus**.

## 10. Pertanyaan terbuka

1. ~~Corporate action~~ gugur.
2. Konfirmasi akun Telegram baru sudah join grup BST + sumber `TG_API_ID/HASH`.
3. Perintah mulai implementasi.

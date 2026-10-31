# TODO — status backend catch-up + frontend

Diperbarui 2026-10-31. Rencana lengkap: `PLAN_WEEKEND_CATCHUP.md`. Panduan operasional: `backend/HERMES_GUIDE.md`.

## Sudah selesai

**Backend (`D:\zenith_saas_local\backend`, salinan dari `D:\zenith_saas`)**
- DataSectors dihapus total. Pipeline catch-up (`ops/weekend_catchup.py`) lengkap + tes.
- Login Telegram selesai (`ops/state/session_joker_2.session`, akun Yosef Setya Buana).
- **ID topik grup BST berubah** (topik dibuat ulang ±28 Okt 2026). Pemetaan baru di `config.py`
  (bisa ditimpa lewat `.env`): SM = Trigger Smart Money 2612196, BM = Trigger Bad Money 2613921,
  MF+ = Live MF+ 2612286, MF- = Live MF- 2610972. Topik "Top …" dan "Big …" TIDAK dipakai.
- Riwayat Telegram hanya tersedia sejak 28–29 Okt 2026 (topik lama terhapus). Opsi `--price-only-before DD-MM-YYYY`
  mengisi harga untuk hari sebelum itu.
- **Data lama dipulihkan dari SQLite** `D:\zenith_saas_algo_dev\zenith_local.db` (alat: `ops/import_sqlite_raw.py`, ada tes):
  SM/BM 15 Sep 2025 → 22 Mei 2026 (542.352 baris), MF 23 Feb → 22 Mei 2026 (1.419.996 baris). Terverifikasi per bulan.
  Celah **23 Mei → 27 Okt 2026 tidak punya sumber SM/BM/MF** (hanya harga). Laporan lengkap: `LAPORAN_IMPOR.md`.
- Cadangan tabel sebelum impor: `backend/ops/state/pg_before_sqlite_import.dump`.
- `ops/run_local.py`: API lokal untuk frontend (127.0.0.1:5000, tanpa debug, scraper + price cache mati,
  auto-login, CORS ke port Vite). JANGAN jalankan `python app.py` apa adanya: `SCRAPER_ENABLED` default 1
  akan menyalakan listener Telegram dan membuka 0.0.0.0 dengan debugger.

**Frontend (`D:\zenith_saas_local\frontend`; dipindah dari `D:\zenith_saas_v2` pada 31 Okt 2026)**
- Terhubung ke API lokal lewat `.env.development.local` (`npm run dev`); `npm run dev:mock` untuk data tiruan.
- Hidup: Hub (IHSG + snapshot), Flow (picker tanggal = query nyata), Transactions, Sector, Stock
  (candle Yahoo + panel SM/BM), BSJP (kosong: BSJP nonaktif).
- Tidak tersedia dari backend (halaman bilang begitu, bukan data tiruan): Portfolio, Admin,
  Trade Book + Broker Summary di Stock.
- 441 tes lulus, typecheck + build bersih, diperiksa di Chromium terhadap API nyata.
- Frontend lama (redesign React 19 + Tailwind) dihapus dari root; arsipnya: `D:\zenith_saas_local_backup\frontend_lama_2026-10-31.zip`.

## Yang menunggu kamu

0. (Selesai 2026-10-31) Penyelarasan universe 847 ticker untuk 15 Sep 2025 → 30 Okt 2026: semua tahap `tertunda = 0`. Lihat `LAPORAN_IMPOR.md`.

1. **Daftarkan cron Hermes** untuk lanjut mengisi data tiap akhir pekan. Folder `scripts` Hermes belum
   ada di mesin ini — lihat HERMES_GUIDE §6 (daftar dengan `--paused` dulu). Tanpa cron, data berhenti di 30 Okt.
2. Port 5173 dipakai server statis proyek lain (PID 33252, sejak 25 Okt). Pakai `--port` lain atau hentikan
   proses itu sendiri jika memang tidak dipakai.

## Keputusan yang sudah diambil

- Harga harian = Yahoo saja (tidak ter-adjust corporate action; risiko diterima).
- BSJP nonaktif (`BSJP_CATCHUP=1` menyalakan; dibahas nanti).
- Narrative dibiarkan apa adanya (user: dibuat nanti).
- Langkah A (cek DB Railway lama) dibatalkan: backfill dari nol.

## Terbuka / belum dikerjakan

- **Git:** satu repo di root (`D:\zenith_saas_local`, origin = github.com/machiavellia-lynn/zenith_saas_local, cabang `main`).
  `.git` lama dipindah ke `D:\zenith_saas_local_backup\` (`backend.git-live` = salinan repo LIVE beserta riwayat lamanya,
  `frontend.git`). Jangan dikembalikan ke dalam `backend\` atau `frontend\`.
- Halaman Stock: jendela bawaan 1 sesi, jadi grafik hanya 1 candle (desain asli). Pertimbangkan default lebih lebar.
- Sector/BSJP/Portfolio: date picker masih "pemilih snapshot" (tidak query ulang); hanya Flow dan Stock yang query ulang.
- Data flow Okt 1–28 kosong (nol) — Flow menampilkan keterangan "prices only".
- Rotasi kredensial lama di `ZENITH_HANDOFF_v4.md` / `structure/ZENITH_HANDOFF_v5.md`.
- Opsional: `listen_addresses = 'localhost'` di `D:\postgresql\data\postgresql.conf`; backup `pg_dump` bulanan.

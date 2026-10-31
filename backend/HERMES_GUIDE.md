# HERMES_GUIDE — Zenith weekend catch-up (laptop)

Dokumen ini untuk Hermes dan untuk Machi. Isinya: apa yang dikerjakan script, cara
menjalankan, cara membaca statusnya, dan apa yang dilakukan bila ada masalah.

## 1. Apa ini

Zenith dulu jalan harian sebagai daemon di server. Di laptop ia hanya jalan **Sabtu
dan Minggu (WIB)**, hanya untuk **mengisi data** (tidak ada web, tidak ada listener
realtime). Satu script, `ops/weekend_catchup.py`, mencari hari bursa yang belum
lengkap lalu menyelesaikannya.

- Repo kode: `D:\zenith_saas_local\backend` (salinan kerja; `D:\zenith_saas` tidak diubah)
- Database: PostgreSQL lokal, DB `zenith`, user `zenith_user` (`DATABASE_URL` di `.env`)
- Sumber harga: **Yahoo Finance** saja. DataSectors sudah dihapus.
- Sumber flow: riwayat grup Telegram BST (4 topik: SM, BM, MF+, MF-)
- Algo BSJP: **nonaktif**. Kodenya ada; candle 15m tidak diambil.

## 2. Tahap per hari bursa (selalu urut kronologis)

| Tahap | Isi |
|---|---|
| `telegram` | Baca riwayat 4 topik → `raw_messages`, `raw_mf_messages` |
| `summary` | Agregasi flow → `eod_summary` |
| `daily_ohlcv` | OHLCV harian Yahoo → `price_history` (plus pemanasan ±354 hari kalender untuk MA200) |
| `seed_sync` | Baris `eod_summary` untuk semua ticker aktif + sinkron harga |
| `analytics` | SRI, fase Wyckoff, MA/RSI/BB → `eod_summary` |
| `bsjp_ind` | 19 indikator BSJP (murni dari harga harian) → `price_history` |
| `m15`, `bsjp_scan`, `bsjp_result` | **Hanya bila `BSJP_CATCHUP=1`.** Default mati. |

Status tiap (tanggal × tahap) disimpan di tabel `catchup_day_status`:
`done`, `holiday` (bursa tutup / tak ada pesan), `skipped` (hulunya libur), `retry` (sedang diulang).
Karena itu Sabtu lalu Minggu tidak mengulang pekerjaan, dan satu tahap tidak dianggap
selesai hanya karena tabelnya "terlihat terisi".

## 3. Menjalankan

```
python ops/weekend_catchup.py            # normal; hanya jalan Sabtu/Minggu WIB
python ops/weekend_catchup.py --status   # progres per tahap, hanya baca
python ops/weekend_catchup.py --dry-run  # tampilkan rencana, tidak menulis
python ops/weekend_catchup.py --force    # abaikan gerbang akhir pekan (uji manual)
python ops/weekend_catchup.py --from 01-09-2026 --to 30-10-2026
```

Aturan perilaku:
- Gerbang: Sabtu/Minggu WIB (zona laptop Taipei tidak dipakai). `--force` melewatinya.
- Hanya hari bursa **selesai**: sebelum hari ini, atau hari ini setelah 17:00 WIB.
- Satu instance sekaligus (lock `ops/state/catchup.lock`, otomatis bersih bila proses mati).
- **stdout kosong = tidak ada yang dikerjakan.** Ada isi hanya bila ada kerja, error, atau diblokir.
- Log lengkap: `ops/state/catchup.log` (UTF-8, berputar 5 MB × 3).

Kode keluar: `0` ok / tak ada kerja · `1` satu tahap gagal · `3` sesi Telegram belum login · `4` argumen salah.

## 4. Pertama kali (sekali saja)

1. `.env` sudah berisi `TG_API_ID`, `TG_API_HASH`. (Akun Telegram baru, sudah join grup BST.)
2. Login OTP — **jalankan sendiri**, jangan lewat chat:
   `! python ops/tg_login.py`
   Hasilnya `ops/state/session_joker_2.session` dan pengecekan bahwa 4 topik bisa dibaca.
3. Cek tanpa menulis: `python ops/weekend_catchup.py --status`
4. Backfill pertama: `python ops/weekend_catchup.py --force --verbose`
   Menelusuri **seluruh** riwayat Telegram sekali, lalu mengambil harga dan menghitung.
   Bisa memakan waktu lama (≈800 ticker × Yahoo). Aman dihentikan dan dilanjutkan: tahap
   yang sudah `done` tidak diulang.
5. Setelah beres dan `--status` menunjukkan kolom *tertunda* nol, daftarkan cron (bagian 6).

## 5. Membaca `--status`

```
tahap          done  libur  skip  retry  tertunda
telegram        ...
```
- *tertunda* > 0 pada tahap awal → belum diproses; akan dikerjakan run berikutnya.
- *retry* > 0 → Yahoo mengembalikan data tipis; diulang sampai 3 kali, lalu diterima apa adanya.
- Hari `holiday` di `telegram` berarti tidak ada pesan sama sekali (libur bursa); tahap hilirnya `skipped`.

## 6. Pemicu Hermes (jangan didaftarkan sebelum langkah 4 selesai)

Cron tanpa LLM, tiap 30 menit. Script keluar cepat bila tidak ada pekerjaan.

```
hermes cron create "every 30m" --no-agent --script <launcher> --name "Zenith weekend catch-up" --deliver local
```

`<launcher>` = `ops/hermes_launcher.py`. Hermes mengharapkan script berada di folder
`scripts` miliknya (`~/.hermes/scripts/`) — **folder itu belum ada di mesin ini**, jadi
lokasi pastinya harus dipastikan saat mendaftar: buat dulu dengan `--paused`, baca pesan
errornya, salin `hermes_launcher.py` ke folder yang diminta, lalu aktifkan. Launcher
memakai Python sistem 3.12 (punya `telethon` dan `psycopg2`); ganti dengan env
`ZENITH_PYTHON` bila perlu. Cron berbasis jam, bukan "saat boot": bila laptop mati,
tick berikutnya mengejar.

## 7. Troubleshooting

| Gejala | Penyebab / tindakan |
|---|---|
| Output `telegram: DIBLOKIR — session file not found` | Belum login. Jalankan `! python ops/tg_login.py`. |
| `session not authorised` | Sesi kedaluwarsa/dicabut. Login ulang. |
| `AuthKeyDuplicated` di log | Sesi yang sama dipakai di tempat lain. Pastikan VPS lama mati; login ulang. |
| `Yahoo bermasalah (x/y ticker)` | Rate-limit/outage. Tidak ada hari yang diklasifikasi; run berikutnya mengulang. Tunggu. |
| Banyak hari `holiday` yang tampak keliru | Cek `--status`; hari terbaru (≤1 hari) sengaja tidak dilabeli libur sampai yakin. |
| Tidak ada output sama sekali di hari Sabtu | Normal bila semua sudah `done`. Cek `--status`. |
| Dua run bertabrakan | Tidak terjadi: lock. Run kedua keluar diam-diam. |
| `analytics: ... tidak ada baris eod_summary — berhenti` | `seed_sync` belum menghasilkan baris untuk tanggal itu; cek `price_history` tanggal tsb. |

## 8. Batasan yang diketahui

- **Yahoo meng-adjust split/rights secara retroaktif** dan tidak ada sumber kedua untuk
  memperbaikinya. Detektor lama (`detect_back_adjustments`) dijalankan di akhir tiap run, tetapi
  dengan satu sumber harga ia hampir tidak akan menemukan apa pun. Harga ticker yang pernah
  split/rights perlu diperiksa manual.
- Hasil BSJP (bila diaktifkan) selalu telat 1 hari bursa. Candle 15m Yahoo hanya ±60 hari ke belakang;
  tanggal lebih lama ditandai `skipped` di tahap `m15`.
- Tahap `m15`/`bsjp_scan`/`bsjp_result` **belum pernah dijalankan end-to-end dengan data nyata**;
  yang teruji hanya inti penulis hasil (`ops/bsjp_results.py`) lewat data buatan.
- Data Telegram yang sudah terhapus dari grup tidak bisa dipulihkan; backfill mengambil apa yang masih ada.
- Kredensial lama di `ZENITH_HANDOFF_v4.md` dan `structure/ZENITH_HANDOFF_v5.md` (TG hash lama, `ACCESS_KEY`,
  `UPLOAD_SECRET`) sebaiknya dirotasi bila masih berlaku.

## 9. Opsional

- Tutup port 5432 dari jaringan luar: `listen_addresses = 'localhost'` di `D:\postgresql\data\postgresql.conf`, restart service.
- Backup sebulan sekali: `D:\postgresql\bin\pg_dump.exe -U zenith_user -F c -f zenith_YYYYMM.dump zenith`.
- Mengaktifkan BSJP nanti: set `BSJP_CATCHUP=1` di `.env`. Tahap-tahap itu lalu mengejar riwayat yang masih dalam jendela 15m.

## 8. Menjalankan API lokal untuk frontend

```
cd D:\zenith_saas_local\backend
python ops/run_local.py            # http://127.0.0.1:5000  (--port untuk mengganti)
```

Frontend (`D:\zenith_saas_local\frontend`): `npm run dev` membaca `.env.development.local` (`VITE_API_BASE=http://127.0.0.1:5000`).

Beda dengan `python app.py` (entry point produksi):

| | `app.py` | `ops/run_local.py` |
|---|---|---|
| Alamat | `0.0.0.0` + debugger Werkzeug | `127.0.0.1` saja, tanpa debug (alamat lain ditolak) |
| Scraper Telegram | menyala (`SCRAPER_ENABLED` default 1) | tidak menyala |
| Price cache (Yahoo) | thread tiap 30 dtk | tidak menyala; `/api/ihsg` refresh sesuai permintaan, maks. 1x / 2 menit |
| Login | wajib | otomatis admin lokal (aman karena hanya loopback) |
| CORS | – | hanya `localhost`/`127.0.0.1` port 5173–5189 dan 4173–4189 |

Catatan: API menganggap "hari ini" sebagai tanggal bawaan, kosong di akhir pekan. Frontend selalu mengirim tanggal
eksplisit dari `/api/last-date`. `/api/ohlcv` mengambil candle langsung dari Yahoo (bukan dari DB), jadi perlu internet.
Log: `ops/state/serve.out.log` / `serve.err.log` jika dijalankan di latar belakang.

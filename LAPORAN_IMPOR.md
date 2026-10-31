# Laporan impor data historis — 31 Okt 2026

## Ringkasan
Data SM/BM/MF lama dipulihkan dari SQLite ke PostgreSQL lokal, lalu ringkasan, harga, analytics, dan indikator dibangun ulang
untuk 15 Sep 2025 → 30 Okt 2026. **Semua tahap selesai** (273 hari bursa × 847 ticker, 0 tertunda, 0 error).
Proses penyelarasan universe sempat dihentikan sistem karena memori rendah, lalu dilanjutkan dan selesai (lihat "Hasil akhir").

## Sumber
Dicari di seluruh D:, folder profil, dan OneDrive. Yang paling lengkap: `D:\zenith_saas_algo_dev\zenith_local.db`
(487 MB, diubah 24 Mei 2026). Dibuka read-only; tidak diubah.

| Data | Rentang | Baris |
|---|---|---|
| raw_messages (SM/BM) | 15 Sep 2025 → 22 Mei 2026 (164 hari) | 542.352 |
| raw_mf_messages (MF+/MF-) | 23 Feb 2026 → 22 Mei 2026 (56 hari) | 1.419.996 |

Salinan lain lebih tua atau kosong: `D:\fitgirl\zenith.db` (s/d 15 Apr 2026, sama dengan `restore_db\zenith.db.gz`),
`...\zenith_data\zenith.db` (s/d 15 Apr, tanpa MF), `...\zenith_project - Copy\zenith.db` (s/d 17 Mar).

## Yang dilakukan
1. Cadangan tabel terkait: `backend/ops/state/pg_before_sqlite_import.dump` (pg_dump penuh gagal: user tidak punya hak baca `running_trade`).
2. `ops/import_sqlite_raw.py` (baru; `--dry-run` tersedia). Dry-run: 1.962.348 baris valid, 0 dilewati. Impor: +542.352 dan +1.419.996, 0 duplikat.
3. Verifikasi independen: jumlah per bulan di PostgreSQL = SQLite untuk semua bulan.
4. Normalisasi: **tidak ada yang perlu diubah.** Satuan numerik cocok dengan `parse_value` saat ini; semua ticker 4 karakter huruf besar;
   jam `HH:MM:SS`; tanggal valid; tidak ada baris Sabtu/Minggu; kanal valid.
5. Pipeline `weekend_catchup.py` untuk 15 Sep 2025 → 30 Okt 2026: 273 hari bursa terisi, 22 hari libur bursa terdeteksi otomatis oleh Yahoo.
   Hari tanpa SM/BM (termasuk celah 23 Mei → 27 Okt) diproses sebagai hari harga-saja (`--price-only-before 29-10-2026`).

## Temuan
- **Celah tanpa sumber: 23 Mei → 27 Okt 2026** (±108 hari bursa). SQLite berhenti 22 Mei; Telegram baru ada sejak 28 Okt.
  Hari-hari itu berisi harga dan analytics berbasis harga; SM/BM/MF kosong (indikator flow terputus).
- **Telegram tidak menyimpan riwayat lama:** topik bot dibuat ulang 28–29 Okt dan topik lama (beserta pesannya) terhapus.
- **Kualitas data lama baik.** Celah nomor urut Tx per bulan: Sep'25 0,5% · Okt 0,0% · Nov 0,0% · Des 0,1% · Jan 0,0% · Feb 0,3% · Mar 0,0%
  · Apr 0,4% · **Mei 1,8%**. Sebagai pembanding, data Telegram 30 Okt kehilangan 5,6% (SM) dan 7,8% (BM).
  Pendengar realtime lama menangkap hampir semuanya, jadi sebagian baris yang "tidak terkirim" di riwayat Telegram kemungkinan
  dihapus bot setelahnya, bukan tak pernah dikirim. Ini indikasi, bukan bukti: perilaku bot bisa saja berubah antara Mei dan Okt.
- **Format lama:** Sep–Nov 2025 belum punya lampu 🟢/🔴 (`signal` kosong ±80% Sep–Okt, 30% Nov) dan 86.042 baris tanpa `freq`. Tidak diisi (bukan kesalahan).
- **Pesan "GAP UP/DOWN"** (22 pesan di Live MF+, format tabel berbeda) tidak diparse; parser asli juga tidak.
- **Kesalahan yang kubuat dan sudah dibereskan:** harga 82 ticker yang baru masuk universe pada 30 Okt hanya diambil 27–30 Okt, sehingga RSI Oktober
  kosong di 10 hari pertama. Diperbaiki dengan mengulang tahap harga–indikator untuk Oktober.

## Hasil akhir
Universe ticker bertambah menjadi 847 (ticker dari data lama ikut terdaftar). Bulan-bulan sebelum Oktober sempat diproses saat universe 530,
jadi harga → indikator diulang untuk seluruh rentang. Proses itu sempat dihentikan sistem (memori rendah), dilanjutkan, dan selesai.
Status akhir `weekend_catchup.py --status` (15 Sep 2025 → 30 Okt 2026, 295 hari kerja): semua tahap `tertunda = 0`
(273 hari diproses + 22 libur bursa).

| Bulan | Hari | Baris (847/hari) | Ber-SM/BM | Ber-MF | Ber-analytics |
|---|---|---|---|---|---|
| 2025-09 | 12 | 10.164 | 4.269 | 0 | 10.164 |
| 2025-10 | 23 | 19.481 | 7.512 | 0 | 19.481 |
| 2025-11 | 20 | 16.940 | 7.533 | 0 | 16.940 |
| 2025-12 | 20 | 16.940 | 10.220 | 0 | 16.940 |
| 2026-01 | 20 | 16.940 | 10.731 | 0 | 16.940 |
| 2026-02 | 18 | 15.246 | 8.691 | 2.470 | 15.246 |
| 2026-03 | 17 | 14.399 | 7.030 | 7.001 | 14.399 |
| 2026-04 | 21 | 17.787 | 9.666 | 9.643 | 17.787 |
| 2026-05 | 16 | 13.552 | 6.083 | 6.082 | 13.552 |
| 2026-06 | 20 | 16.940 | 0 | 0 | 16.940 |
| 2026-07 | 23 | 19.481 | 0 | 0 | 19.481 |
| 2026-08 | 19 | 16.093 | 0 | 0 | 16.093 |
| 2026-09 | 22 | 18.634 | 0 | 0 | 18.634 |
| 2026-10 | 22 | 18.634 | 792 | 789 | 18.634 |

Total `eod_summary` 231.231 baris; `price_history` 348.616 baris (23 Sep 2024 → 30 Okt 2026). Jun–Sep 2026 = celah tanpa SM/BM/MF.
Setiap hari memiliki 847 baris dan semuanya punya analytics (`phase`); pemeriksaan per hari bersih.

Catatan kecil: MFIN pada 22 Sep 2026 sempat kosong akibat kunci tabel saat API dinyalakan bersamaan; sudah dihitung ulang.
Peluncur API (`ops/run_local.py`) kini tidak mengubah skema, jadi aman dinyalakan saat catch-up berjalan.

## File yang dibuat/diubah
`ops/import_sqlite_raw.py` (baru) · `ops/state/pg_before_sqlite_import.dump` · `ops/state/import_sqlite.log` · log pipeline
`ops/state/fullrange.out.log`, `oct_refresh.out.log`, `universe_refresh.out.log`. Sumber SQLite dan folder `D:\zenith_saas` tidak diubah.

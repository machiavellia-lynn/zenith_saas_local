# Zenith SaaS — lokal

Analitik ekuitas IDX (Smart Money / Bad Money / Money Flow) yang berjalan di laptop.
Backend hanya mengisi PostgreSQL lokal pada Sabtu/Minggu WIB; tidak ada web publik dan tidak ada listener realtime.

| Folder | Isi |
|---|---|
| `backend/` | Python/Flask: pipeline catch-up (`ops/weekend_catchup.py`), API lokal (`ops/run_local.py`), tes |
| `frontend/` | React 18 + Vite + TypeScript. Aturannya ada di `frontend/AGENTS.md` |
| `LAPORAN_IMPOR.md` | Laporan impor data historis |
| `TODO_NEXT.md` | Status dan pekerjaan yang tersisa |
| `PLAN_WEEKEND_CATCHUP.md` | Rencana pipeline catch-up |
| `setup_db.ps1` | Membuat user dan database PostgreSQL lokal |

## Menjalankan

```
cd backend  && python ops/run_local.py                     # API di 127.0.0.1:5000
cd frontend && npm run dev -- --port 5174 --strictPort     # web (live, membaca .env.development.local)
cd frontend && npm run dev:mock                            # web dengan data tiruan
```

Jangan menjalankan `python app.py` apa adanya: `SCRAPER_ENABLED` bawaannya `1` sehingga listener Telegram ikut menyala,
dan server terbuka di semua alamat dengan debugger. Panduan operasional: `backend/HERMES_GUIDE.md`.

## Tidak ikut repo

`.env`, sesi Telegram, `backend/ops/state/`, `frontend/.env.development.local`, `node_modules/`.
Buat `backend/.env` dari `backend/.env.example`, dan `frontend/.env.development.local` berisi
`VITE_API_BASE=http://127.0.0.1:5000`.

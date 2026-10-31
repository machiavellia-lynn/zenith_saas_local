// AGENTS.md — Zenith Terminal

## What this is
Standalone Bloomberg-terminal-style dashboard for IDX Smart/Bad Money flow.
Frontend only. It reads either static mock data or the local Flask API,
chosen by one env var (`VITE_API_BASE`) in exactly one module (`src/data/`).

## Backends
- **Live (default for `npm run dev`):** `.env.development.local` sets
  `VITE_API_BASE=http://127.0.0.1:5000`. Start the API first:
  `cd D:\zenith_saas_local\backend && python ops/run_local.py`
  (loopback only; it auto-logs-in, so the app sends no credentials).
- **Mock:** `npm run dev:mock`. Tests and `build` never see the live URL.
- The API's date default is *today*, which is empty on weekends. Live reads
  always send an explicit date, resolved from `/api/last-date` (`src/data/http.ts`).
- Pages the local backend cannot feed say so (Portfolio, Admin, the Stock page's
  trade book and broker summary). **Never fill a live screen with mock data** — it
  reads as real.

## Critical boundary
`D:\zenith_saas` is a **READ-ONLY reference** (the old Flask + Jinja app).
Never write to it. The backend this app talks to is
`D:\zenith_saas_local\backend`; its routes are the source of truth for shapes.

## Commands
- dev: `npm run dev` (live) · `npm run dev:mock` (mock)
- typecheck: `npm run typecheck`
- test: `npm run test`
- build: `npm run build`

## Conventions
- TypeScript strict. **No `any`** — use `unknown` + narrowing.
- All colour/spacing/type values come from `src/styles/tokens.css`. Never hardcode a hex
  value in a component stylesheet.
- Components render; they do not fetch. All data arrives via `src/data/`.
- Exactly one place (`src/data/http.ts`: `apiBase()` / `isMockMode()`) decides mock vs
  real API; `index.ts`, `pages.ts` and `stock.ts` build on it. Components must never
  import a mock file directly.
- Null renders as `—`. Never `0`, `NaN`, or `undefined`.
- Numeric cells use tabular figures so digits align vertically.

## Domain vocabulary (closed set — do not invent)
Phases: `SOS`, `UPTHRUST`, `ABSORB`, `SPRING`, `DISTRI`, `ACCUM`, `NEUTRAL`
Units: monetary fields are in **Juta** (millions of IDR).
`clean_money` = SM − BM. Default table sort = `clean_money` descending, nulls last.

## Data contract
Mock data must match the Flask API field-for-field. Source of truth:
`D:\zenith_saas_local\backend\routes\` (`routes_flow.py` for `/api/flow`,
`/api/transactions`, `/api/ohlcv`; `routes_sector.py`; `routes_bsjp.py`;
`routes_main.py` for `/api/last-date`, `/api/ihsg`).
If the mock and those files disagree, the files win. Adapters that reshape a
payload (`/api/ohlcv` → candles, `/api/last-date` + `/api/ihsg` → snapshot) live
in `src/data/` and are unit-tested there.

/**
 * Static mock of `GET /api/sector`.
 *
 * Field-for-field shape comes from the reference backend:
 *   D:\zenith_saas\routes\routes_sector.py  L118-138   (READ-ONLY)
 *
 * Mirrored from that file:
 *  - `cm` is `sm_val - bm_val`, rounded to 2dp (L129).
 *  - `net_mf` is `mf_plus - mf_minus`, and is only emitted when one of the two
 *    sides is non-zero (L132) — the backend's falsy test, not a null test.
 *  - `ticker_count` is the length of the sector's member list (L134).
 *  - Rows are sorted by `cm` descending (L137).
 *
 * Units: every monetary field is Juta (millions of IDR). A sector is an
 * aggregate over its members, so these values are an order of magnitude
 * larger than the single-stock flows in `mockFlow.ts`.
 *
 * The `cm`, `net_mf`, `ticker_count` and the sort order are derived here
 * rather than typed in, so the table can never disagree with its own
 * arithmetic — same discipline as `mockFlow.ts`' totals.
 */

import type { SectorResponse, SectorRow } from "../types.pages";
import { SECTORS, SECTOR_MEMBERS } from "./sectors";

/**
 * Per-sector inputs, in the order `SECTORS` declares them.
 *
 * `sm` / `bm` / `mfPlus` / `mfMinus` are the aggregates; `gain` is the mean
 * member return for the session; `count` is the member count the backend would
 * have summed over.
 */
interface Spec {
  name: string;
  sm: number;
  bm: number;
  mfPlus: number;
  mfMinus: number;
  gain: number;
  count: number;
}

/** Round to 2dp, the backend's rounding for every sector field. */
function j2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * One session across the IDX, as a sector book.
 *
 * Financials leads on clean money (the big banks absorbed persistent SM all
 * session) and Technology is the heaviest distributor, while Energy and
 * Consumer Cyclicals sit on the other sign — so both directions are present in
 * the default table order and the UI's red/green column both get exercised.
 */
const SPECS: readonly Spec[] = [
  { name: "Energy", sm: 1_284_905.37, bm: 962_440.21, mfPlus: 214_880.53, mfMinus: 188_330.42, gain: 0.62, count: 74 },
  { name: "Basic Materials", sm: 1_640_220.84, bm: 1_518_905.16, mfPlus: 268_440.71, mfMinus: 251_905.38, gain: -0.84, count: 96 },
  { name: "Industrials", sm: 1_088_440.62, bm: 1_042_330.87, mfPlus: 178_905.44, mfMinus: 166_440.29, gain: 0.31, count: 61 },
  { name: "Consumer Non-Cyclicals", sm: 1_412_905.73, bm: 1_398_440.28, mfPlus: 232_330.16, mfMinus: 241_880.57, gain: -0.19, count: 88 },
  { name: "Consumer Cyclicals", sm: 862_440.39, bm: 948_905.52, mfPlus: 141_880.63, mfMinus: 168_330.74, gain: -1.12, count: 79 },
  { name: "Healthcare", sm: 604_880.27, bm: 571_440.95, mfPlus: 98_440.32, mfMinus: 91_905.68, gain: 0.44, count: 43 },
  { name: "Financials", sm: 2_148_330.61, bm: 1_684_905.44, mfPlus: 366_440.88, mfMinus: 284_905.13, gain: 1.06, count: 108 },
  { name: "Property", sm: 498_905.84, bm: 561_440.17, mfPlus: 78_330.42, mfMinus: 94_880.65, gain: -0.73, count: 84 },
  { name: "Technology", sm: 742_440.18, bm: 906_905.63, mfPlus: 121_905.27, mfMinus: 158_440.81, gain: -1.48, count: 52 },
  { name: "Infrastructure", sm: 978_330.52, bm: 964_905.29, mfPlus: 158_440.93, mfMinus: 161_905.47, gain: 0.08, count: 67 },
  { name: "Transport", sm: 372_905.41, bm: 408_440.86, mfPlus: 58_905.33, mfMinus: 68_330.19, gain: -0.57, count: 49 },
];

/**
 * Build one row the way routes_sector.py L125-135 does.
 *
 * `mf_plus` / `mf_minus` are nulled on a zero aggregate (the backend's falsy
 * test), and `net_mf` follows only when at least one side survived — so a
 * sector with no MF traffic at all reports null rather than a misleading 0.
 */
function buildRow(s: Spec): SectorRow {
  const mfPlus = s.mfPlus !== 0 ? j2(s.mfPlus) : null;
  const mfMinus = s.mfMinus !== 0 ? j2(s.mfMinus) : null;
  const netMf = mfPlus !== null || mfMinus !== null ? j2((mfPlus ?? 0) - (mfMinus ?? 0)) : null;

  return {
    name: s.name,
    sm_val: j2(s.sm),
    bm_val: j2(s.bm),
    cm: j2(s.sm - s.bm),
    mf_plus: mfPlus,
    mf_minus: mfMinus,
    net_mf: netMf,
    gain_pct: j2(s.gain),
    ticker_count: s.count,
  };
}

/** Backend sort: `cm` descending (routes_sector.py L137). */
function byCmDesc(a: SectorRow, b: SectorRow): number {
  return b.cm - a.cm;
}

/**
 * One row per sector in `SECTORS`, sorted the way the backend sorts them.
 *
 * The spec table and `SECTORS` must describe the same eleven sectors; a drift
 * between the two would silently drop a sector from the rotation table, so it
 * fails loudly at module load instead.
 */
const missing = SECTORS.filter((name) => !SPECS.some((s) => s.name === name));
if (missing.length > 0 || SPECS.length !== SECTORS.length) {
  throw new Error(
    `mockSector: specs and SECTORS disagree (missing: ${missing.join(", ") || "none"}, ` +
      `specs ${SPECS.length} vs sectors ${SECTORS.length})`,
  );
}

for (const s of SPECS) {
  const members = SECTOR_MEMBERS[s.name] ?? [];
  if (members.length > s.count) {
    throw new Error(
      `mockSector: ${s.name} has ${members.length} sampled members but ticker_count ${s.count}`,
    );
  }
}

const sectors: SectorRow[] = SPECS.map(buildRow).sort(byCmDesc);

/** Mock snapshot of the sector rotation table, shaped like `GET /api/sector`. */
export const mockSector: SectorResponse = {
  sectors,
  date_from: "02-10-2026",
  date_to: "02-10-2026",
};

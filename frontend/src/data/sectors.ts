/**
 * Sector metadata, mirroring `config.SECTORS` in the reference app.
 *
 * The reference defines 12 sectors mapping a name to its member tickers. The
 * frontend only needs the sector NAMES plus a representative sample of members
 * for mock data — it never needs the full 700-ticker membership list, because
 * the backend is what aggregates.
 *
 * Source: D:\zenith_saas\config.py (READ-ONLY reference).
 */

export const SECTORS: readonly string[] = [
  "Energy",
  "Basic Materials",
  "Industrials",
  "Consumer Non-Cyclicals",
  "Consumer Cyclicals",
  "Healthcare",
  "Financials",
  "Property",
  "Technology",
  "Infrastructure",
  "Transport",
] as const;

/** A small, plausible membership sample per sector for the detail view. */
export const SECTOR_MEMBERS: Record<string, readonly string[]> = {
  Energy: ["ADRO", "PTBA", "ITMG", "PGAS", "MEDC", "AKRA"],
  "Basic Materials": ["ANTM", "MDKA", "INCO", "INTP", "SMGR", "TPIA", "AMMN"],
  Industrials: ["ASII", "UNTR", "ARNA", "MARK", "TOTO"],
  "Consumer Non-Cyclicals": ["INDF", "ICBP", "UNVR", "MYOR", "GGRM", "HMSP", "CPIN"],
  "Consumer Cyclicals": ["ACES", "MAPI", "ERAA", "MNCN", "SCMA", "LPPF"],
  Healthcare: ["KLBF", "MIKA", "SIDO", "KAEF", "HEAL", "SILO"],
  Financials: ["BBCA", "BBRI", "BMRI", "BBNI", "BBTN", "BRIS", "ARTO", "BDMN"],
  Property: ["BSDE", "CTRA", "PWON", "SMRA", "LPKR", "ASRI"],
  Technology: ["GOTO", "BUKA", "EMTK", "MTDL", "DCII"],
  Infrastructure: ["TLKM", "TOWR", "TBIG", "EXCL", "ISAT", "JSMR", "MTEL", "PGEO"],
  Transport: ["BIRD", "ASSA", "SMDR", "TMAS", "GIAA", "HELI"],
};

/** Sector display order used when a sort is not active. */
export function sectorOrder(name: string): number {
  const i = SECTORS.indexOf(name);
  return i === -1 ? SECTORS.length : i;
}

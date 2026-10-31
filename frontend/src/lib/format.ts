/**
 * Number formatting for the terminal.
 *
 * Rules (PRD US-006):
 *  - Juta values compact to M/B above 1,000 / 1,000,000.
 *  - Percentages carry an explicit sign.
 *  - null renders as an em dash, never 0 / NaN / undefined.
 *  - Negative zero renders as "0".
 */

/** Shown wherever a value is absent. */
export const EM_DASH = "—";

/** Collapse -0 to 0 so we never print "-0". */
function normalizeZero(n: number): number {
  return Object.is(n, -0) || n === 0 ? 0 : n;
}

/**
 * Format a Juta value compactly.
 * 845.3 -> "845.3", 1234 -> "1.2M", 2_450_000 -> "2.5B"
 * Note: labels M/B are magnitude markers over the Juta unit, matching the
 * trader convention in the reference UI.
 */
/**
 * Format a Juta value compactly.
 * 845.3 -> "845.3", 150 -> "150.0", 1234 -> "1.2M", 2_450_000 -> "2.5B"
 *
 * Below 1,000 we keep one decimal: these are financial magnitudes, and
 * dropping the fraction at 3 digits loses ~10% of the table's precision.
 */
export function formatJuta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  const n = normalizeZero(value);
  const abs = Math.abs(n);

  // Largest magnitude first, so each branch is reachable.
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}B`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}M`;
  return n.toFixed(1);
}

/** Format a percentage with an explicit sign: "+2.31%", "-0.85%", "0.00%". */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  const n = normalizeZero(value);
  if (n === 0) return "0.00%";
  const sign = n > 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

/** Format an integer with thousands separators. */
export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return normalizeZero(Math.round(value)).toLocaleString("en-US");
}

/** Format a ratio in 0..~N range to 2dp, e.g. SRI / RPR. */
export function formatRatio(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return normalizeZero(value).toFixed(dp);
}

/** Format a plain price with no decimals (IDX prices are whole rupiah). */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return formatInt(value);
}

/** Sign of a value for colour decisions. Null is treated as flat. */
export function signOf(value: number | null | undefined): -1 | 0 | 1 {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  const n = normalizeZero(value);
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

/** CSS class for a directional value. */
export function directionClass(value: number | null | undefined): string {
  const s = signOf(value);
  if (s > 0) return "val-up";
  if (s < 0) return "val-down";
  return "val-flat";
}

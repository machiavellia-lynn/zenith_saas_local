/**
 * Date helpers for the terminal.
 *
 * Three formats are in play and conflating them causes real bugs, so each has
 * a distinct name:
 *   - ISO      `YYYY-MM-DD` — the internal/storage form (reference: price_history)
 *   - Display  `DD-MM-YYYY` — the form the Flask API uses in payloads and query
 *                             params (reference: routes_flow.py `date_from`)
 *   - Label    `2 Oct 26`   — what the picker shows (reference: StockbitDatePicker._fmt)
 *
 * The reference's own `_keyFromDate` produces ISO and passes it to `onChange`,
 * while the API takes DD-MM-YYYY. Both directions are provided here.
 */

/** ISO `YYYY-MM-DD` for a Date, in local time. */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Parse an ISO `YYYY-MM-DD` as a *local* date, avoiding UTC drift. */
export function fromIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** API display form `DD-MM-YYYY`, from ISO. */
export function isoToDisplay(iso: string): string {
  const d = fromIso(iso);
  if (d === null) return iso;
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}-${d.getFullYear()}`;
}

/** ISO from API display form `DD-MM-YYYY`. */
export function displayToIso(display: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(display);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Picker label form, e.g. `2 Oct 26`, matching the reference's `_fmt`. */
export function formatLabel(iso: string): string {
  const d = fromIso(iso);
  if (d === null) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

/** `2 Oct 26 – 14 Oct 26`, or a single date when from === to. */
export function formatRange(fromIsoStr: string, toIsoStr: string): string {
  if (fromIsoStr === toIsoStr) return formatLabel(fromIsoStr);
  return `${formatLabel(fromIsoStr)} – ${formatLabel(toIsoStr)}`;
}

/** Whole days between two ISO dates (b − a). */
export function daysBetween(aIso: string, bIso: string): number {
  const a = fromIso(aIso);
  const b = fromIso(bIso);
  if (a === null || b === null) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Shift an ISO date by n days. */
export function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  if (d === null) return iso;
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** True when `iso` falls inside [from, to] inclusive, order-insensitive. */
export function withinRange(iso: string, from: string, to: string): boolean {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return iso >= lo && iso <= hi;
}

/** Ordered pair: the earlier date first. */
export function orderRange(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/** Presets the reference offers in its date strip. */
export interface RangePreset {
  key: string;
  label: string;
  /** Days back from the anchor date; 0 means the anchor day itself. */
  span: number;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { key: "1D", label: "1D", span: 0 },
  { key: "1W", label: "1W", span: 6 },
  { key: "1M", label: "1M", span: 29 },
  { key: "3M", label: "3M", span: 89 },
  { key: "1Y", label: "1Y", span: 364 },
] as const;

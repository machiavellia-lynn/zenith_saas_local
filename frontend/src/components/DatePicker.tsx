import { useEffect, useMemo, useRef, useState } from "react";
import {
  RANGE_PRESETS,
  addDays,
  formatLabel,
  formatRange,
  fromIso,
  orderRange,
  toIso,
} from "../lib/date";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface DateRange {
  /** ISO `YYYY-MM-DD`, inclusive. */
  from: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  to: string;
}

interface Props {
  value: DateRange;
  onChange: (next: DateRange) => void;
  /** Labelled by the caller so it reads as a range control. */
  label?: string;
  /** Disable the prev/next day steppers, e.g. for a fixed snapshot. */
  enableSteppers?: boolean;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/**
 * Date-range picker.
 *
 * Two-step like the reference's StockbitDatePicker: the first click sets the
 * start, the second sets the end, and a third starts a new range. A single
 * click yields from === to, which every consumer treats as one day.
 *
 * Keyboard: the grid is a real table of buttons, so Tab and Enter work; Escape
 * closes and returns focus to the trigger.
 */
export function DatePicker({
  value,
  onChange,
  label = "Date range",
  enableSteppers = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<"from" | "to">("from");
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => {
    const d = fromIso(value.from);
    return d ?? new Date();
  });
  const rootRef = useRef<HTMLDivElement>(null);

  const { from, to } = value;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPendingFrom(null);
        setPicking("from");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPendingFrom(null);
        setPicking("from");
        rootRef.current?.querySelector<HTMLElement>(".dp-trigger")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  /** Six weeks of cells covering the month, so the grid never jumps height. */
  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const total = daysInMonth(year, month);
    const out: { iso: string | null; day: number | null }[] = [];
    for (let i = 0; i < firstWeekday; i++) out.push({ iso: null, day: null });
    for (let d = 1; d <= total; d++) {
      out.push({ iso: toIso(new Date(year, month, d)), day: d });
    }
    while (out.length % 7 !== 0) out.push({ iso: null, day: null });
    return out;
  }, [year, month]);

  const stepMonth = (delta: number) => {
    setCursor(new Date(year, month + delta, 1));
  };

  const clickDay = (iso: string) => {
    if (picking === "from") {
      setPendingFrom(iso);
      setPicking("to");
      return;
    }
    const [a, b] = orderRange(pendingFrom ?? iso, iso);
    onChange({ from: a, to: b });
    setPendingFrom(null);
    setPicking("from");
    setOpen(false);
  };

  const applyPreset = (span: number) => {
    // The newest data is the anchor, so a preset looks backwards from `to`.
    const anchor = to;
    onChange({ from: addDays(anchor, -span), to: anchor });
    setOpen(false);
  };

  const shift = (n: number) => {
    const [a, b] = orderRange(from, to);
    onChange({ from: addDays(a, n), to: addDays(b, n) });
  };

  const rangeLo = pendingFrom ?? from;
  const rangeHi = pendingFrom === null && picking === "to" ? to : pendingFrom ?? to;

  const inRange = (iso: string): boolean => {
    const [lo, hi] = orderRange(rangeLo, rangeHi);
    return iso >= lo && iso <= hi;
  };

  return (
    <div className="dp" ref={rootRef}>
      {enableSteppers && (
        <button
          type="button"
          className="dp-step"
          aria-label="Previous day"
          onClick={() => shift(-1)}
        >
          ‹
        </button>
      )}

      <button
        type="button"
        className="dp-trigger"
        aria-label={`${label}: ${formatRange(from, to)}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((v) => !v);
          setPicking("from");
          setPendingFrom(null);
        }}
      >
        <span className="dp-trigger-icon" aria-hidden="true">
          ▦
        </span>
        <span className="dp-trigger-text">
          {from === to ? formatLabel(from) : formatRange(from, to)}
        </span>
      </button>

      {enableSteppers && (
        <button
          type="button"
          className="dp-step"
          aria-label="Next day"
          onClick={() => shift(1)}
        >
          ›
        </button>
      )}

      {open && (
        <div className="dp-pop" role="dialog" aria-label={label}>
          <div className="dp-presets">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="dp-preset"
                onClick={() => applyPreset(p.span)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="dp-head">
            <button
              type="button"
              className="dp-nav"
              aria-label="Previous month"
              onClick={() => stepMonth(-1)}
            >
              ‹
            </button>
            <span className="dp-month">
              {MONTH_NAMES[month]} {year}
            </span>
            <button
              type="button"
              className="dp-nav"
              aria-label="Next month"
              onClick={() => stepMonth(1)}
            >
              ›
            </button>
          </div>

          <div className="dp-hint" aria-live="polite">
            {picking === "from" ? "Pick start date" : "Pick end date"}
          </div>

          <table className="dp-grid">
            <thead>
              <tr>
                {WEEKDAYS.map((w) => (
                  <th key={w} scope="col">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, row) => (
                <tr key={row}>
                  {cells.slice(row * 7, row * 7 + 7).map((cell, i) => {
                    if (cell.iso === null) {
                      return <td key={`pad-${row}-${i}`} className="dp-pad" />;
                    }
                    const iso = cell.iso;
                    const isEdge = iso === from || iso === to;
                    const isPending = iso === pendingFrom;
                    return (
                      <td key={iso}>
                        <button
                          type="button"
                          className={`dp-day${inRange(iso) ? " dp-in-range" : ""}${
                            isEdge ? " dp-edge" : ""
                          }${isPending ? " dp-pending" : ""}`}
                          aria-label={formatLabel(iso)}
                          aria-pressed={inRange(iso)}
                          onClick={() => clickDay(iso)}
                        >
                          {cell.day}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

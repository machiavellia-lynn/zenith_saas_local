import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_STRUCTURE_KEYS,
  STRUCTURE_METRICS,
  searchableMetrics,
} from "../lib/structure";

interface Props {
  /** Currently selected metric keys, in display order. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

/**
 * Gear button + popover controlling which metrics the STRUCTURE section shows.
 *
 * Applies immediately (no Apply button) so the effect is visible behind the
 * popover, and offers a reset to the defaults. Selection can never be emptied
 * — the last remaining metric cannot be unchecked — because a section with no
 * rows is indistinguishable from a bug.
 */
export function StructureSettings({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedSet = new Set(selected);

  // Close on outside click and on Escape, and return focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        rootRef.current?.querySelector<HTMLElement>(".panel-gear")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const toggle = (key: string) => {
    if (selectedSet.has(key)) {
      // Refuse to empty the section.
      if (selected.length <= 1) return;
      onChange(selected.filter((k) => k !== key));
      return;
    }
    // Keep the canonical metric order rather than click order.
    const next = STRUCTURE_METRICS.filter(
      (m) => selectedSet.has(m.key) || m.key === key,
    ).map((m) => m.key);
    onChange(next);
  };

  const visible = searchableMetrics(query);

  return (
    <div className="panel-gear-wrap" ref={rootRef}>
      <button
        type="button"
        className="panel-gear"
        aria-label="Structure metrics settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Choose which metrics this section shows"
        onClick={() => setOpen((v) => !v)}
      >
        ⚙
      </button>

      {open && (
        <div className="panel-gear-pop" role="dialog" aria-label="Structure metrics">
          <div className="panel-gear-head">
            <span>STRUCTURE METRICS</span>
            <span className="panel-gear-count">
              {selected.length}/{STRUCTURE_METRICS.length}
            </span>
          </div>

          <input
            className="panel-gear-search"
            type="text"
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter metrics"
          />

          <div className="panel-gear-list">
            {visible.length === 0 && (
              <div className="panel-gear-empty">No metric matches “{query}”.</div>
            )}
            {visible.map((m) => {
              const on = selectedSet.has(m.key);
              const locked = on && selected.length <= 1;
              return (
                <label
                  key={m.key}
                  className={`panel-gear-item${on ? " on" : ""}`}
                  title={m.title}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={locked}
                    onChange={() => toggle(m.key)}
                  />
                  <span className="panel-gear-label">{m.label}</span>
                </label>
              );
            })}
          </div>

          <div className="panel-gear-foot">
            <button
              type="button"
              className="btn"
              onClick={() => onChange([...DEFAULT_STRUCTURE_KEYS])}
            >
              RESET
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

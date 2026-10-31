import type { TickerRow } from "../types";
import {
  EM_DASH,
  directionClass,
  formatInt,
  formatJuta,
  formatPct,
  formatPrice,
  formatRatio,
} from "../lib/format";
import { phaseClass, phasePresentation } from "../lib/phase";
import { nextSort, type SortKey, type SortState } from "../lib/sort";

interface Column {
  key: SortKey;
  label: string;
  /** Left-aligned text column rather than a right-aligned numeric one. */
  text?: boolean;
  title?: string;
}

/**
 * Column order mirrors the trader's scan order, not the API's field order.
 * SRI is deliberately absent: it is available in the detail panel, but the
 * table carries the ten columns the trader scans.
 */
const COLUMNS: Column[] = [
  { key: "ticker", label: "TICKER", text: true },
  { key: "price", label: "PRICE" },
  { key: "gain_pct", label: "CHG%" },
  { key: "sm_val", label: "SM", title: "Smart money value, Juta" },
  { key: "bm_val", label: "BM", title: "Bad money value, Juta" },
  { key: "clean_money", label: "NET CM", title: "Clean money = SM − BM, Juta" },
  { key: "rsm", label: "RSM", title: "Smart money as % of total value" },
  { key: "tx", label: "TX", title: "Transaction count" },
  { key: "phase", label: "PHASE", text: true },
  { key: "action", label: "ACTION", text: true },
];

interface Props {
  rows: readonly TickerRow[];
  sort: SortState;
  onSortChange: (next: SortState) => void;
  selected: string | null;
  onSelect: (ticker: string) => void;
}

/** Sortable ticker table. PRD US-009 and US-010. */
export function TickerTable({ rows, sort, onSortChange, selected, onSelect }: Props) {
  return (
    <table className="ticker-table">
      <thead>
        <tr>
          {COLUMNS.map((col) => {
            const active = sort.key === col.key;
            return (
              <th
                key={col.key}
                scope="col"
                className={active ? "sorted" : undefined}
                style={col.text ? { textAlign: "left" } : undefined}
                title={col.title}
                aria-sort={
                  active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                }
                onClick={() => onSortChange(nextSort(sort, col.key))}
              >
                {col.label}
                <span className="sort-ind" aria-hidden="true">
                  {active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isSelected = row.ticker === selected;
          const p = phasePresentation(row.phase);
          return (
            <tr
              key={row.ticker}
              className={isSelected ? "selected" : undefined}
              aria-selected={isSelected}
              onClick={() => onSelect(row.ticker)}
            >
              <td className="col-ticker">{row.ticker}</td>
              <td>{formatPrice(row.price)}</td>
              <td className={directionClass(row.gain_pct)}>{formatPct(row.gain_pct)}</td>
              <td className={directionClass(row.sm_val)}>{formatJuta(row.sm_val)}</td>
              <td className={directionClass(row.bm_val)}>{formatJuta(row.bm_val)}</td>
              <td className={directionClass(row.clean_money)}>
                {formatJuta(row.clean_money)}
              </td>
              <td>{row.rsm === null ? EM_DASH : `${formatRatio(row.rsm, 1)}%`}</td>
              <td>{formatInt(row.tx)}</td>
              <td className="col-text">
                <span className={phaseClass(row.phase)}>{p.label}</span>
              </td>
              <td className="col-text">{row.action ?? EM_DASH}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

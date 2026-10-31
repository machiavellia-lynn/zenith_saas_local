import { useMemo } from "react";
import type { TickerRow, TransactionsResponse } from "../types";
import { EM_DASH, formatInt, formatJuta, formatPct, formatPrice, formatRatio } from "../lib/format";
import { phasePresentation } from "../lib/phase";
import { structureMetric, type StructureMetric } from "../lib/structure";
import { StructureSettings } from "./StructureSettings";

interface KVProps {
  k: string;
  v: string;
  tone?: string;
}

function KV({ k, v, tone = "" }: KVProps) {
  return (
    <>
      <div className="kv-key">{k}</div>
      <div className={`kv-val ${tone}`}>{v}</div>
    </>
  );
}

/**
 * Read a metric off a row, keeping the StructureMetric's own null handling.
 * `read` may return a number, a string, or null; a null renders as an em dash
 * rather than 0, and a non-finite number is treated as missing.
 */
function rawValue(row: TickerRow, m: StructureMetric): number | string | null {
  const v = m.read(row);
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return v;
}

function numValue(row: TickerRow, m: StructureMetric): number | null {
  const v = rawValue(row, m);
  return typeof v === "number" ? v : null;
}

function textValue(row: TickerRow, m: StructureMetric): string {
  const v = rawValue(row, m);
  if (v === null) return EM_DASH;
  return typeof v === "number" ? String(v) : v;
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="panel-section">
      <div className="panel-section-head">
        <div className="panel-section-title">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * One channel's transaction tape.
 * SM and BM are distinguished by a text tag as well as colour, because colour
 * alone is not an accessible or scannable distinction. PRD US-012.
 */
function Tape({
  label,
  rows,
  tagClass,
}: {
  label: string;
  rows: TransactionsResponse["sm"];
  tagClass: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="state-block" style={{ padding: "10px" }}>
        No {label} transactions.
      </div>
    );
  }

  return (
    <table className="tape-table">
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>
            <span className={`tape-tag ${tagClass}`}>{label}</span>
          </th>
          <th>TIME</th>
          <th>PRICE</th>
          <th>CHG%</th>
          <th>MF</th>
          <th>VOL×</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${label}-${r.date}-${r.time}-${i}`}>
            <td style={{ textAlign: "left" }}>{r.signal ?? EM_DASH}</td>
            <td>{r.time}</td>
            <td>{formatPrice(r.price)}</td>
            <td>{formatPct(r.gain_pct)}</td>
            <td>{r.mf ?? EM_DASH}</td>
            <td>{formatRatio(r.vol_x)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Props {
  row: TickerRow;
  tape: TransactionsResponse | null;
  onClose: () => void;
  /** Metric keys the STRUCTURE section should render, in order. */
  structureKeys: readonly string[];
  onStructureChange: (next: string[]) => void;
}

/** The full picture for one selected ticker. PRD US-011 and US-012. */
export function DetailPanel({
  row,
  tape,
  onClose,
  structureKeys,
  onStructureChange,
}: Props) {
  const p = phasePresentation(row.phase);

  // Resolve the selected keys to metrics, dropping any key the current build
  // no longer knows about.
  const metrics = useMemo(
    () => structureKeys.map(structureMetric).filter((m): m is StructureMetric => m !== undefined),
    [structureKeys],
  );

  return (
    <aside className="side-panel" role="complementary" aria-label={`${row.ticker} details`}>
      <div className="panel-header">
        <div>
          <div className="panel-ticker">{row.ticker}</div>
          <div className="stat-card-sub">{p.label} · {row.action ?? EM_DASH}</div>
        </div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close details">
          ESC
        </button>
      </div>

      <Section title="Signal">
        <div className="narrative">{p.description}</div>
      </Section>

      <Section title="Flow">
        <div className="kv-grid">
          <KV k="PRICE" v={formatPrice(row.price)} />
          <KV k="CHG%" v={formatPct(row.gain_pct)} />
          <KV k="SM" v={formatJuta(row.sm_val)} />
          <KV k="BM" v={formatJuta(row.bm_val)} />
          <KV k="NET CM" v={formatJuta(row.clean_money)} />
          <KV k="CM STREAK" v={formatInt(row.cm_streak)} />
          <KV k="MF+" v={formatJuta(row.mf_plus)} />
          <KV k="MF−" v={formatJuta(row.mf_minus)} />
          <KV k="NET MF" v={formatJuta(row.net_mf)} />
          <KV k="TX" v={formatInt(row.tx)} />
        </div>
      </Section>

      <Section title="Intensity">
        <div className="kv-grid">
          <KV k="RSM" v={row.rsm === null ? EM_DASH : `${formatRatio(row.rsm, 1)}%`} />
          <KV k="SRI" v={formatRatio(row.sri)} />
          <KV k="MES" v={formatRatio(row.mes)} />
          <KV k="RPR" v={formatRatio(row.rpr)} />
          <KV k="ATR%" v={formatRatio(row.atr_pct)} />
          <KV k="VOLX GAP" v={formatRatio(row.volx_gap)} />
        </div>
      </Section>

      <Section
        title="Structure"
        action={<StructureSettings selected={structureKeys} onChange={onStructureChange} />}
      >
        {metrics.length === 0 ? (
          <div className="state-block" style={{ padding: "8px" }}>
            No structure metrics selected.
          </div>
        ) : (
          <div className="kv-grid">
            {metrics.map((m) => (
              <KV
                key={m.key}
                k={m.label}
                v={m.dp === null ? textValue(row, m) : formatRatio(numValue(row, m), m.dp)}
              />
            ))}
          </div>
        )}
      </Section>

      {row.narrative !== null && row.narrative.length > 0 && (
        <Section title="Narrative">
          <div className="narrative">{row.narrative}</div>
        </Section>
      )}

      <Section title="Transactions">
        {tape === null ? (
          <div className="state-block" style={{ padding: "10px" }}>
            Loading tape…
          </div>
        ) : (
          <div className="tape">
            <Tape label="SM" rows={tape.sm} tagClass="tape-tag-sm" />
            <Tape label="BM" rows={tape.bm} tagClass="tape-tag-bm" />
          </div>
        )}
      </Section>
    </aside>
  );
}

import type { FlowTotals } from "../types";
import { EM_DASH, directionClass, formatInt, formatJuta } from "../lib/format";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}

function StatCard({ label, value, sub, tone = "" }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className={`stat-card-value ${tone}`}>{value}</div>
      {sub !== undefined && <div className="stat-card-sub">{sub}</div>}
    </div>
  );
}

/**
 * The day's aggregate flow, shown above the table.
 * PRD US-008: six values plus the ticker count; net values are coloured by sign.
 */
export function StatStrip({ totals }: { totals: FlowTotals }) {
  const hasCount = Number.isFinite(totals.count);

  return (
    <div className="stat-strip" role="region" aria-label="Market flow totals">
      <StatCard
        label="SM"
        value={formatJuta(totals.sm)}
        sub="smart money"
        tone="val-up"
      />
      <StatCard
        label="BM"
        value={formatJuta(totals.bm)}
        sub="bad money"
        tone="val-down"
      />
      <StatCard
        label="NET CM"
        value={formatJuta(totals.net_cm)}
        sub="SM − BM"
        tone={directionClass(totals.net_cm)}
      />
      <StatCard
        label="MF+"
        value={formatJuta(totals.mf_plus)}
        sub="inflow"
        tone="val-up"
      />
      <StatCard
        label="MF−"
        value={formatJuta(totals.mf_minus)}
        sub="outflow"
        tone="val-down"
      />
      <StatCard
        label="NET MF"
        value={formatJuta(totals.net_mf)}
        sub="net flow"
        tone={directionClass(totals.net_mf)}
      />
      <StatCard
        label="TICKERS"
        value={hasCount ? formatInt(totals.count) : EM_DASH}
        sub="in view"
      />
    </div>
  );
}

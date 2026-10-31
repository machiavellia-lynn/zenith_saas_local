import { useEffect, useState } from "react";
import type { MarketSnapshot } from "../types.pages";
import { fetchSnapshot as defaultFetchSnapshot, fetchSector as defaultFetchSector } from "../data/pages";
import { fetchFlow as defaultFetchFlow } from "../data";
import type { FlowResponse, TickerRow } from "../types";
import type { SectorResponse } from "../types.pages";
import { EM_DASH, directionClass, formatJuta, formatPct, formatInt } from "../lib/format";
import { phaseClass, phasePresentation } from "../lib/phase";
import { ErrorState, LoadingState } from "../components/States";
import { hashFor } from "../lib/router";

interface Props {
  fetchSnapshot?: typeof defaultFetchSnapshot;
  fetchFlow?: typeof defaultFetchFlow;
  fetchSector?: typeof defaultFetchSector;
  onNavigate?: (hash: string) => void;
}

/**
 * The landing page: market snapshot plus "where to look first".
 *
 * It is deliberately a summary, not a dashboard of dashboards — each card links
 * to the page that actually answers the question it raises.
 */
export default function HubPage({
  fetchSnapshot = defaultFetchSnapshot,
  fetchFlow = defaultFetchFlow,
  fetchSector = defaultFetchSector,
  onNavigate,
}: Props) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [sector, setSector] = useState<SectorResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setStatus("loading");
      const [s, f, sec] = await Promise.all([fetchSnapshot(), fetchFlow(), fetchSector()]);
      if (cancelled) return;
      if (s.status === "error") {
        setStatus("error");
        setError(s.error);
        return;
      }
      setSnapshot(s.data);
      setFlow(f.status === "ready" ? f.data : null);
      setSector(sec.status === "ready" ? sec.data : null);
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchSnapshot, fetchFlow, fetchSector]);

  if (status === "loading") return <LoadingState />;
  if (status === "error" && error !== null) return <ErrorState message={error} />;

  const topAccum: TickerRow[] = flow
    ? [...flow.tickers]
        .filter((t) => t.clean_money !== null)
        .sort((a, b) => (b.clean_money ?? 0) - (a.clean_money ?? 0))
        .slice(0, 6)
    : [];

  const topDistri: TickerRow[] = flow
    ? [...flow.tickers]
        .filter((t) => t.clean_money !== null)
        .sort((a, b) => (a.clean_money ?? 0) - (b.clean_money ?? 0))
        .slice(0, 6)
    : [];

  const go = (page: string) => {
    if (onNavigate) onNavigate(page);
    else window.location.hash = page;
  };

  return (
    <div className="hub-page">
      <div className="hub-hero">
        <div>
          <div className="hub-kicker">MARKET SNAPSHOT</div>
          <div className="hub-ihsg">
            <span className="hub-ihsg-val">
              {snapshot ? formatInt(snapshot.ihsg) : EM_DASH}
            </span>
            <span className={`hub-ihsg-chg ${directionClass(snapshot?.ihsg_gain_pct)}`}>
              {formatPct(snapshot?.ihsg_gain_pct)}
            </span>
          </div>
          <div className="hub-meta">
            <span className={`hub-status hub-status-${(snapshot?.status ?? "CLOSED").toLowerCase()}`}>
              {snapshot?.status ?? "—"}
            </span>
            <span>{snapshot?.as_of ?? EM_DASH}</span>
            <span>{snapshot?.time ?? EM_DASH}</span>
          </div>
        </div>

        <div className="hub-totals">
          <div className="hub-total">
            <div className="stat-card-label">NET CLEAN MONEY</div>
            <div className={`hub-total-val ${directionClass(flow?.totals.net_cm)}`}>
              {formatJuta(flow?.totals.net_cm)}
            </div>
          </div>
          <div className="hub-total">
            <div className="stat-card-label">NET MF</div>
            <div className={`hub-total-val ${directionClass(flow?.totals.net_mf)}`}>
              {formatJuta(flow?.totals.net_mf)}
            </div>
          </div>
          <div className="hub-total">
            <div className="stat-card-label">TICKERS</div>
            <div className="hub-total-val">{formatInt(flow?.totals.count ?? null)}</div>
          </div>
        </div>
      </div>

      <div className="hub-grid">
        <section className="hub-card">
          <header className="hub-card-head">
            <h2 className="hub-card-title">Top accumulation</h2>
            <button type="button" className="btn" onClick={() => go(hashFor("flow"))}>
              Open Flow →
            </button>
          </header>
          <table className="hub-table">
            <thead>
              <tr>
                <th>TICKER</th>
                <th>NET CM</th>
                <th>RSM</th>
                <th>PHASE</th>
              </tr>
            </thead>
            <tbody>
              {topAccum.map((t) => (
                <tr key={t.ticker}>
                  <td className="col-ticker">{t.ticker}</td>
                  <td className={directionClass(t.clean_money)}>{formatJuta(t.clean_money)}</td>
                  <td>{t.rsm === null ? EM_DASH : `${t.rsm.toFixed(1)}%`}</td>
                  <td>
                    <span className={phaseClass(t.phase)}>{phasePresentation(t.phase).label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="hub-card">
          <header className="hub-card-head">
            <h2 className="hub-card-title">Top distribution</h2>
            <button type="button" className="btn" onClick={() => go(hashFor("flow"))}>
              Open Flow →
            </button>
          </header>
          <table className="hub-table">
            <thead>
              <tr>
                <th>TICKER</th>
                <th>NET CM</th>
                <th>RSM</th>
                <th>PHASE</th>
              </tr>
            </thead>
            <tbody>
              {topDistri.map((t) => (
                <tr key={t.ticker}>
                  <td className="col-ticker">{t.ticker}</td>
                  <td className={directionClass(t.clean_money)}>{formatJuta(t.clean_money)}</td>
                  <td>{t.rsm === null ? EM_DASH : `${t.rsm.toFixed(1)}%`}</td>
                  <td>
                    <span className={phaseClass(t.phase)}>{phasePresentation(t.phase).label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="hub-card">
          <header className="hub-card-head">
            <h2 className="hub-card-title">Sector rotation</h2>
            <button type="button" className="btn" onClick={() => go(hashFor("sector"))}>
              Open Sector →
            </button>
          </header>
          <table className="hub-table">
            <thead>
              <tr>
                <th>SECTOR</th>
                <th>NET CM</th>
                <th>GAIN%</th>
              </tr>
            </thead>
            <tbody>
              {(sector?.sectors ?? []).slice(0, 6).map((s) => (
                <tr key={s.name}>
                  <td className="col-ticker">{s.name}</td>
                  <td className={directionClass(s.cm)}>{formatJuta(s.cm)}</td>
                  <td className={directionClass(s.gain_pct)}>{formatPct(s.gain_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="hub-card hub-card-shortcuts">
          <header className="hub-card-head">
            <h2 className="hub-card-title">Jump to</h2>
          </header>
          <div className="hub-shortcuts">
            <button type="button" className="btn" onClick={() => go(hashFor("stock"))}>
              Stock
            </button>
            <button type="button" className="btn" onClick={() => go(hashFor("bsjp"))}>
              BSJP Scanner
            </button>
            <button type="button" className="btn" onClick={() => go(hashFor("portfolio"))}>
              Portfolio
            </button>
            <button type="button" className="btn" onClick={() => go(hashFor("admin"))}>
              Admin
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

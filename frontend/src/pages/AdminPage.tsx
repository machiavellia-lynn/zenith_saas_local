import { useEffect, useMemo, useState } from "react";
import type { AdminJob, AdminResponse } from "../types.pages";
import { fetchAdmin as defaultFetchAdmin } from "../data/pages";
import { EM_DASH, formatInt } from "../lib/format";
import { ErrorState, LoadingState } from "../components/States";
import { DatePicker, type DateRange } from "../components/DatePicker";
import { displayToIso, withinRange } from "../lib/date";

interface Props {
  fetchAdmin?: typeof defaultFetchAdmin;
}

const STATUS_CLASS: Record<AdminJob["status"], string> = {
  idle: "job-idle",
  running: "job-running",
  ok: "job-ok",
  failed: "job-failed",
};

/** `last_run` looks like `02-10-2026 17:31`; take just the date part. */
function jobDate(lastRun: string | null): string | null {
  if (lastRun === null) return null;
  const first = lastRun.trim().split(/\s+/)[0];
  return first === undefined ? null : displayToIso(first);
}

/** Read-only data operations view. No controls that would mutate anything. */
export default function AdminPage({ fetchAdmin = defaultFetchAdmin }: Props) {
  const [data, setData] = useState<AdminResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchAdmin();
      if (cancelled) return;
      if (res.status === "error") {
        setStatus("error");
        setError(res.error);
        return;
      }
      setData(res.data);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAdmin]);

  /**
   * Seed the picker from the newest job run, since the admin payload carries no
   * explicit date range. Jobs with no recorded run are left out of the seed.
   */
  useEffect(() => {
    if (range !== null || data === null) return;
    const dates = data.jobs.map((j) => jobDate(j.last_run)).filter((d): d is string => d !== null);
    if (dates.length === 0) return;
    dates.sort();
    setRange({ from: dates[0]!, to: dates[dates.length - 1]! });
  }, [data, range]);

  /**
   * Jobs whose last run falls inside the window. The picker here filters the
   * job list, which is the only per-row date this page has — an admin view has
   * no market-date concept of its own.
   */
  const jobs = useMemo(() => {
    if (data === null) return [];
    if (range === null) return data.jobs;
    return data.jobs.filter((j) => {
      const d = jobDate(j.last_run);
      if (d === null) return true; // never run: always visible, it needs attention
      return withinRange(d, range.from, range.to);
    });
  }, [data, range]);

  if (status === "loading") return <LoadingState />;
  if (status === "error" && error !== null) return <ErrorState message={error} />;
  if (data === null) return <ErrorState message="No admin data." />;

  return (
    <div className="admin-page">
      <div className="page-toolbar">
        {range !== null && (
          <DatePicker value={range} onChange={setRange} label="Last run window" />
        )}
        <span className="page-toolbar-spacer" />
        <span className="page-toolbar-note">
          {formatInt(jobs.length)} of {formatInt(data.jobs.length)} jobs shown
        </span>
      </div>

      <div className="admin-summary">
        <div className="admin-stat">
          <div className="stat-card-label">TICKERS</div>
          <div className="stat-card-value">{formatInt(data.counts.tickers)}</div>
        </div>
        <div className="admin-stat">
          <div className="stat-card-label">EOD ROWS</div>
          <div className="stat-card-value">{formatInt(data.counts.eod_summary)}</div>
        </div>
        <div className="admin-stat">
          <div className="stat-card-label">RAW MESSAGES</div>
          <div className="stat-card-value">{formatInt(data.counts.raw_messages)}</div>
        </div>
        <div className="admin-stat">
          <div className="stat-card-label">BSJP SIGNALS</div>
          <div className="stat-card-value">{formatInt(data.counts.bsjp_signals)}</div>
        </div>
        <div className="admin-stat">
          <div className="stat-card-label">UNIVERSE</div>
          <div className="stat-card-value">{data.universe}</div>
        </div>
        <div className="admin-stat">
          <div className="stat-card-label">LAST INGEST</div>
          <div className="stat-card-value admin-small">{data.last_ingest ?? EM_DASH}</div>
        </div>
      </div>

      <div className="panel-section-title" style={{ padding: "10px 10px 0" }}>
        Data jobs
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>JOB</th>
            <th style={{ textAlign: "left" }}>SCHEDULE</th>
            <th>STATUS</th>
            <th>ROWS</th>
            <th style={{ textAlign: "left" }}>LAST RUN</th>
            <th style={{ textAlign: "left" }}>LAST RESULT</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && (
            <tr>
              <td colSpan={6} className="state-block">
                No job ran in the selected window.
              </td>
            </tr>
          )}
          {jobs.map((job) => (
            <tr key={job.key}>
              <td style={{ textAlign: "left" }}>
                <div className="admin-job-name">{job.name}</div>
                <div className="admin-job-desc">{job.description}</div>
              </td>
              <td style={{ textAlign: "left" }}>{job.schedule}</td>
              <td>
                <span className={`job-status ${STATUS_CLASS[job.status]}`}>{job.status}</span>
              </td>
              <td>{formatInt(job.rows)}</td>
              <td style={{ textAlign: "left" }}>{job.last_run ?? EM_DASH}</td>
              <td style={{ textAlign: "left" }}>{job.last_result ?? EM_DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admin-note">
        Read-only. This terminal is a frontend on mock data — it cannot trigger or mutate any job.
      </div>
    </div>
  );
}

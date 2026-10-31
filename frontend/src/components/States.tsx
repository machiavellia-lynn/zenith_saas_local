/** Loading, error, and empty states. PRD US-015. */

export function LoadingState() {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <div className="skeleton" style={{ height: 14, width: "60%", margin: "0 auto 8px" }} />
      <div className="skeleton" style={{ height: 14, width: "40%", margin: "0 auto 8px" }} />
      <div className="skeleton" style={{ height: 14, width: "50%", margin: "0 auto" }} />
      <div style={{ marginTop: 12 }}>Loading…</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block" role="alert">
      <div style={{ marginBottom: 8 }}>Could not load data.</div>
      <div className="stat-card-sub" style={{ marginBottom: 12 }}>
        {message}
      </div>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="state-block" role="status">
      No tickers to display for this date range.
    </div>
  );
}

"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page">
      <div className="empty" role="alert" style={{ marginTop: "var(--sp-10)" }}>
        <h3>Something went wrong</h3>
        <p>
          The marketplace could not load this view. No data was changed. Try again, or
          return to the overview.
        </p>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <button className="btn btn--sm" type="button" onClick={() => reset()}>
            Try again
          </button>
          <a className="btn btn--sm btn--secondary" href="/">
            Go to overview
          </a>
        </div>
      </div>
    </div>
  );
}

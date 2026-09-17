export default function Loading() {
  return (
    <div className="page" role="status" aria-live="polite">
      <div className="skeleton skeleton--title" style={{ width: 240, height: 28 }} />
      <div className="skeleton skeleton--text" style={{ width: "48%", marginBottom: "var(--sp-8)" }} />
      <div className="stats" style={{ border: 0, background: "transparent", gap: "var(--sp-4)" }}>
        {[0, 1, 2, 3].map((index) => (
          <div className="skeleton" key={index} style={{ height: 92 }} />
        ))}
      </div>
      <div className="asset-grid" style={{ marginTop: "var(--sp-8)" }}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div className="skeleton skeleton--card" key={index} />
        ))}
      </div>
      <span className="skip-link">Loading the marketplace…</span>
    </div>
  );
}

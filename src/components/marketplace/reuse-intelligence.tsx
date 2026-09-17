import { BarChart } from "@/components/charts/bar-chart";
import { IconAlert, IconCheck, IconEmpty } from "@/components/ui/icons";
import type { ReuseIntelligence } from "@/contracts";

function formatDate(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * How the asset has actually been used. Every number is a count of saved runs;
 * the dimensions the system does not record are named rather than guessed at.
 */
export function ReuseIntelligencePanel({ reuse }: { reuse: ReuseIntelligence }) {
  if (reuse.total === 0) {
    return (
      <div className="empty" style={{ padding: "var(--sp-8) var(--sp-5)" }}>
        <span className="empty__icon">
          <IconEmpty style={{ width: 20, height: 20 }} />
        </span>
        <h3>No one has run this yet</h3>
        <p>
          This asset is a reference you adapt rather than something you run, so there are no
          saved runs to report.
        </p>
      </div>
    );
  }

  const successRate = Math.round((reuse.succeeded / reuse.total) * 100);

  return (
    <div>
      <div className="stats" style={{ marginBottom: "var(--sp-5)" }}>
        <div className="stat">
          <span className="stat__value t-num">{reuse.total}</span>
          <span className="stat__label">Times run</span>
          <span className="stat__hint">
            {formatDate(reuse.first_run)} to {formatDate(reuse.last_run)}
          </span>
        </div>
        <div className="stat">
          <span className="stat__value t-num">{reuse.succeeded}</span>
          <span className="stat__label">Worked</span>
          <span className="stat__hint">{successRate}% of all runs</span>
        </div>
        <div className="stat">
          <span className="stat__value t-num">{reuse.rejected}</span>
          <span className="stat__label">Turned away</span>
          <span className="stat__hint">Refused bad input instead of guessing</span>
        </div>
        <div className="stat">
          <span className="stat__value t-num">{reuse.distinct_scenarios}</span>
          <span className="stat__label">Different jobs</span>
          <span className="stat__hint">Same asset, different situations</span>
        </div>
      </div>

      <BarChart
        data={reuse.scenarios.map((scenario) => ({
          label: scenario.label,
          value: scenario.runs,
          tone: scenario.succeeded === scenario.runs ? "positive" : "warning",
          note: `${scenario.succeeded} worked`,
        }))}
        caption="What people have used this asset for, by number of runs. Answers: is it reused for more than the job it was built for?"
        tableLabel="Job"
        valueLabel="Runs"
      />

      <div
        className={`notice notice--${reuse.reuse_proved ? "info" : "warning"}`}
        style={{ marginTop: "var(--sp-5)" }}
      >
        {reuse.reuse_proved ? (
          <IconCheck className="notice__icon" />
        ) : (
          <IconAlert className="notice__icon" />
        )}
        <div>
          <strong>
            {reuse.reuse_proved
              ? "Proven to work on more than one job"
              : "Reuse across jobs has not been proven"}
          </strong>
          <p style={{ marginTop: 2 }}>
            {reuse.reuse_proved
              ? "Two different jobs were run against the same unchanged asset, and both results are saved."
              : "There is no saved comparison showing the same unchanged asset working on two different jobs."}
          </p>
        </div>
      </div>

      <details className="tech" style={{ marginTop: "var(--sp-4)" }}>
        <summary>View technical details</summary>
        <div style={{ padding: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
          <dl className="definition">
            <div>
              <dt>Runs by people</dt>
              <dd className="t-num">{reuse.user_runs}</dd>
            </div>
            <div>
              <dt>Pre-publication test runs</dt>
              <dd className="t-num">{reuse.prepublication_runs}</dd>
            </div>
            <div>
              <dt>Summary</dt>
              <dd>{reuse.observation}</dd>
            </div>
          </dl>
          {reuse.not_recorded.map((note) => (
            <p className="t-caption" style={{ marginTop: "var(--sp-3)" }} key={note}>
              {note}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

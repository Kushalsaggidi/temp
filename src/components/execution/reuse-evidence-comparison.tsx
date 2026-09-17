import type { ReuseComparison } from "@/modules/execution/reuse-comparison";

import styles from "./reuse-evidence-comparison.module.css";

export function ReuseEvidenceComparison({
  comparison,
}: {
  comparison: ReuseComparison;
}) {
  if (!comparison.available) {
    return (
      <section
        className={styles.unavailable}
        aria-labelledby="reuse-evidence-title"
      >
        <p className={styles.kicker}>Reuse proof</p>
        <h2 id="reuse-evidence-title">No reuse proof yet</h2>
        <p>{unavailableMessage(comparison.reason)}</p>
        <p className={styles.reasonCode}>Reason: {comparison.reason}</p>
      </section>
    );
  }

  return (
    <section className={styles.comparison} aria-labelledby="reuse-evidence-title">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Reuse proof</p>
          <h2 id="reuse-evidence-title">Same asset, two different jobs</h2>
          <p>
            Both runs used the exact same asset, unchanged, on two different jobs. Each run
            was saved, so you can check them yourself.
          </p>
        </div>
        <span className={styles.verified}>Checked</span>
      </header>

      <div className={styles.scenarios}>
        {comparison.scenarios.map((scenario, index) => (
          <article className={styles.scenario} key={scenario.execution_id}>
            <p className={styles.scenarioNumber}>{index === 0 ? "1" : "2"}</p>
            <h3>{scenario.scenario_label}</h3>
            <dl>
              <div>
                <dt>Run ID</dt>
                <dd>{scenario.execution_id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{scenario.status}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{scenario.started_at}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{scenario.completed_at}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className={styles.shared}>
        <div>
          <p className={styles.kicker}>Shared provenance</p>
          <h3>Identical execution identity</h3>
        </div>
        <dl>
          <div>
            <dt>Asset ID</dt>
            <dd>{comparison.shared.asset_id}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{comparison.shared.asset_version}</dd>
          </div>
          <div>
            <dt>Asset version ID</dt>
            <dd>{comparison.shared.asset_version_id}</dd>
          </div>
          <div>
            <dt>Executor key</dt>
            <dd>{comparison.shared.executor_key}</dd>
          </div>
          <div>
            <dt>Definition digest</dt>
            <dd>{comparison.shared.definition_digest}</dd>
          </div>
          <div>
            <dt>Configuration digest</dt>
            <dd>{comparison.shared.configuration_digest}</dd>
          </div>
          <div>
            <dt>Execution purpose</dt>
            <dd>{comparison.shared.execution_purpose.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Subject digest</dt>
            <dd>{comparison.subject_digest}</dd>
          </div>
          <div>
            <dt>Evidence ID</dt>
            <dd>{comparison.evidence_id}</dd>
          </div>
        </dl>
      </div>

      <p className={styles.unchangedStatement}>
        <span aria-hidden="true">✓</span>
        <strong>{comparison.statement}</strong>
      </p>
    </section>
  );
}

function unavailableMessage(reason: Extract<ReuseComparison, { available: false }>["reason"]): string {
  switch (reason) {
    case "invalid_selected_version":
      return "The selected asset version could not be verified.";
    case "invalid_reuse_evidence":
      return "The reuse evidence record could not be verified.";
    case "selected_version_not_frozen_runnable":
      return "The selected version is not a frozen runnable version.";
    case "selected_version_subject_digest_mismatch":
      return "The selected version no longer matches its frozen subject digest.";
    case "evidence_not_passing_reuse_proof":
      return "No passing reuse proof is available for display.";
    case "evidence_not_current_subject":
      return "The available reuse evidence does not match the current frozen subject.";
    case "requires_exactly_two_distinct_executions":
      return "Reuse proof requires exactly two distinct persisted executions.";
    case "execution_records_unavailable":
      return "Both persisted execution records could not be loaded.";
    case "execution_not_succeeded":
      return "Both execution records must show successful outcomes.";
    case "execution_provenance_mismatch":
      return "The persisted runs do not share the required execution provenance.";
    case "execution_validation_incomplete":
      return "The persisted runs do not contain complete passing validation results.";
    case "execution_scenario_mismatch":
      return "The persisted runs are not bound to the two exact frozen scenario fixtures.";
    case "execution_configuration_mismatch":
      return "The persisted runs do not share the same recorded reviewed configuration.";
    case "execution_functional_assertions_incomplete":
      return "The persisted runs did not pass the required usefulness and safety assertions.";
    case "scenarios_not_distinct":
      return "The persisted runs do not identify two distinct scenarios.";
  }
}

"use client";

import { useState } from "react";

import type { GovernanceGate } from "@/modules/governance";

import { IconAlert, IconCheck, IconMinus, IconX } from "./icons";
import { gateCopy, gateStatusWord } from "./language";

const GLYPH = {
  passed: IconCheck,
  stale: IconAlert,
  failed: IconX,
  missing: IconX,
  not_required: IconMinus,
} as const;

/**
 * The main way a reader sees governance: one segment per required check, in
 * plain words. "Not required" is neutral, never a warning, so an optional check
 * is not mistaken for a problem.
 */
export function GateStrip({ gates }: { gates: GovernanceGate[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = gates.find((gate) => gate.key === openKey) ?? null;
  const required = gates.filter((gate) => gate.status !== "not_required");
  const passing = required.filter((gate) => gate.status === "passed").length;
  const problems = required.filter((gate) => gate.status !== "passed").length;

  return (
    <div>
      <ul className="gates">
        {gates.map((gate) => {
          const Glyph = GLYPH[gate.status];
          const copy = gateCopy(gate);
          return (
            <li className={`gate gate--${gate.status}`} key={gate.key}>
              <button
                className="gate__btn"
                type="button"
                aria-pressed={openKey === gate.key}
                aria-label={`${copy.name}: ${gateStatusWord(gate.status)}`}
                title={`${copy.name}: ${gateStatusWord(gate.status)}`}
                onClick={() => setOpenKey(openKey === gate.key ? null : gate.key)}
              >
                <Glyph />
              </button>
            </li>
          );
        })}
      </ul>

      {open ? (
        <div className={`gate-detail gate-detail--${open.status}`} role="status">
          <strong>{gateCopy(open).statement}</strong>
          <p>{gateCopy(open).why}</p>
          <details className="tech" style={{ marginTop: "var(--sp-3)" }}>
            <summary>View technical details</summary>
            <div style={{ padding: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
              <p className="t-small">{open.message}</p>
              {open.evidenceId ? (
                <p className="t-mono" style={{ marginTop: "var(--sp-2)", color: "var(--text-muted)" }}>
                  {open.evidenceId}
                </p>
              ) : null}
            </div>
          </details>
        </div>
      ) : (
        <p className="gate-legend">
          <span>
            {passing} of {required.length} checks complete
            {problems > 0 ? ` · ${problems} still needed` : ""}
          </span>
          <span>Select a check to see what it means</span>
        </p>
      )}
    </div>
  );
}

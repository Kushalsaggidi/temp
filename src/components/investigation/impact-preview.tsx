"use client";

import { useEffect, useRef, useState } from "react";

import type { ImpactPreview } from "@/contracts";
import { IconAlert, IconArrowRight, IconCheck, IconX } from "@/components/ui/icons";

const TONE_CLASS = {
  positive: "pill--success",
  warning: "pill--warning",
  negative: "pill--danger",
  neutral: "",
} as const;

function StateList({
  title,
  facts,
}: {
  title: string;
  facts: ImpactPreview["current_state"];
}) {
  return (
    <div>
      <p className="t-label" style={{ marginBottom: "var(--sp-2)" }}>
        {title}
      </p>
      <ul className="impact-facts">
        {facts.map((item) => (
          <li key={`${title}-${item.label}`}>
            <span className="impact-facts__label">{item.label}</span>
            <span className={`pill ${TONE_CLASS[item.tone]}`}>
              <span className="pill__dot" />
              {item.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A focused decision step between a recommendation and the action itself. Every
 * figure comes from the same records the rest of the page reads, so the user sees
 * what will actually happen before they commit.
 */
export function ImpactPreviewDialog({
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: ImpactPreview;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const needsAcknowledgement = preview.affected.some((item) => item.at_risk);

  useEffect(() => {
    panel.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <>
      <div className="modal-overlay" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="impact-title"
        ref={panel}
        tabIndex={-1}
      >
        <header className="modal__head">
          <div style={{ minWidth: 0 }}>
            <p className="t-label">Before you continue</p>
            <h2 id="impact-title" style={{ marginTop: 2 }}>
              {preview.title}
            </h2>
          </div>
          <button
            className="drawer__close"
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel"
          >
            <IconX style={{ width: 15, height: 15 }} />
          </button>
        </header>

        <div className="modal__body">
          <p className="t-body">{preview.question}</p>

          {!preview.available ? (
            <div className="notice notice--warning" role="status">
              <IconAlert className="notice__icon" />
              <span>{preview.unavailable_reason}</span>
            </div>
          ) : null}

          <div className="impact-grid">
            <StateList title="Now" facts={preview.current_state} />
            <span className="impact-grid__arrow" aria-hidden="true">
              <IconArrowRight style={{ width: 16, height: 16 }} />
            </span>
            <StateList title="After this action" facts={preview.resulting_state} />
          </div>

          <div>
            <p className="t-label" style={{ marginBottom: "var(--sp-2)" }}>
              What this affects
            </p>
            <ul className="impact-affected">
              {preview.affected.map((item) => (
                <li key={item.label} className={item.at_risk ? "is-at-risk" : undefined}>
                  <span className="impact-affected__count t-num">{item.count}</span>
                  <span>
                    <strong>{item.label}</strong>
                    <span className="t-caption" style={{ display: "block" }}>
                      {item.detail}
                    </span>
                  </span>
                  {item.at_risk ? (
                    <IconAlert
                      style={{ width: 15, height: 15, color: "var(--warning)", flex: "none" }}
                    />
                  ) : (
                    <IconCheck
                      style={{ width: 15, height: 15, color: "var(--success)", flex: "none" }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>

          {!preview.reversible ? (
            <div className="notice notice--warning">
              <IconAlert className="notice__icon" />
              <div>
                <strong>This cannot be undone</strong>
                <p style={{ marginTop: 2 }}>{preview.reversibility_note}</p>
              </div>
            </div>
          ) : null}

          {needsAcknowledgement && preview.available ? (
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I understand this removes the asset from search for everyone.</span>
            </label>
          ) : null}
        </div>

        <footer className="modal__foot">
          <button className="btn btn--secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            onClick={onConfirm}
            disabled={busy || !preview.available || (needsAcknowledgement && !acknowledged)}
          >
            {busy ? "Working…" : preview.confirm_label}
          </button>
        </footer>
      </div>
    </>
  );
}

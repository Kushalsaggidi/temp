"use client";

import Link from "next/link";

import type { AlternativesResult } from "@/contracts";
import { IconCheck, IconEmpty, IconRun } from "@/components/ui/icons";
import { TrustRing } from "@/components/ui/trust-ring";
import { relativeTime } from "@/components/ui/language";

/**
 * Replacement options, ranked by the same matcher search uses. "Ready to use"
 * here means a higher trust score than the asset being investigated — it is a
 * comparison, never an endorsement.
 */
export function AlternativesList({
  result,
  subjectName,
  now,
  onClose,
}: {
  result: AlternativesResult;
  subjectName: string;
  now: number;
  onClose?: () => void;
}) {
  if (result.alternatives.length === 0) {
    return (
      <div className="empty" style={{ padding: "var(--sp-8) var(--sp-5)" }}>
        <span className="empty__icon">
          <IconEmpty style={{ width: 20, height: 20 }} />
        </span>
        <h3>No alternative covers this job yet</h3>
        <p>
          Nothing else in the catalogue does what {subjectName} does. That makes this a
          genuine gap rather than duplicated work.
        </p>
      </div>
    );
  }

  const compareHref = `/compare?ids=${[result.asset_version_id, ...result.alternatives.slice(0, 2).map((item) => item.asset_version_id)].join(",")}`;

  return (
    <div>
      <p className="t-small" style={{ marginBottom: "var(--sp-4)" }}>
        {result.observation}
      </p>

      <ul className="alt-list">
        {result.alternatives.map((alternative, index) => (
          <li
            className={`alt${alternative.safer ? " alt--safer" : ""}`}
            key={alternative.asset_version_id}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div className="alt__head">
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="alt__name">{alternative.name}</p>
                <p className="t-caption">{alternative.owner}</p>
              </div>
              <TrustRing trust={alternative.trust} size="md" showMeta={false} />
            </div>

            <p className="alt__summary">{alternative.summary}</p>

            <ul className="alt__facts">
              <li>
                <span className="t-caption">Does the same job</span>
                <strong className="t-num">{alternative.similarity}%</strong>
              </li>
              <li>
                <span className="t-caption">Status</span>
                <strong>{alternative.trust.label}</strong>
              </li>
              <li>
                <span className="t-caption">Last checked</span>
                <strong>{relativeTime(alternative.last_reviewed, now).replace("checked ", "")}</strong>
              </li>
            </ul>

            <div className="alt__tags">
              {alternative.safer ? (
                <span className="pill pill--success">
                  <IconCheck style={{ width: 11, height: 11 }} />
                  Better checked than {subjectName}
                </span>
              ) : null}
              {alternative.runnable ? (
                <span className="pill pill--brand">
                  <IconRun style={{ width: 11, height: 11 }} />
                  Can be run
                </span>
              ) : null}
              {alternative.evidence_fresh ? null : (
                <span className="pill pill--warning">
                  <span className="pill__dot" />
                  Checks are out of date
                </span>
              )}
            </div>

            <div className="alt__actions">
              <Link
                className="btn btn--sm"
                href={`/assets/${alternative.asset_version_id}`}
                onClick={onClose}
              >
                Use this asset
              </Link>
              <Link
                className="btn btn--sm btn--secondary"
                href={`/compare?ids=${result.asset_version_id},${alternative.asset_version_id}`}
                onClick={onClose}
              >
                Compare
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {result.alternatives.length > 1 ? (
        <Link
          className="btn btn--sm btn--secondary btn--block"
          href={compareHref}
          onClick={onClose}
          style={{ marginTop: "var(--sp-4)" }}
        >
          Compare all side by side
        </Link>
      ) : null}
    </div>
  );
}

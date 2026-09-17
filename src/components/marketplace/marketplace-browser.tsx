"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { TrustScore } from "@/contracts";
import { InvestigateButton } from "@/components/investigation/investigate-button";
import { needsAttention } from "@/components/marketplace/needs-attention";
import { IconDiscovery, IconEmpty, IconFilter, IconRun } from "@/components/ui/icons";
import { readinessFor, relativeTime } from "@/components/ui/language";
import { TrustRing } from "@/components/ui/trust-ring";

export interface MarketplaceItem {
  assetVersionId: string;
  name: string;
  summary: string;
  owner: string;
  assetType: string;
  availability: string;
  version: string;
  domains: string[];
  audiences: string[];
  trust: TrustScore;
  lastReviewed: string | null;
  blockingGates: string[];
}

type View = "all" | "reviewed" | "runnable" | "recent";
type Sort = "trust_desc" | "trust_asc" | "name" | "recent";

const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All" },
  { key: "reviewed", label: "Ready to use" },
  { key: "runnable", label: "Can be run here" },
  { key: "recent", label: "Checked recently" },
];

function matchesView(item: MarketplaceItem, view: View, now: number): boolean {
  switch (view) {
    case "reviewed":
      return item.trust.band === "strong";
    case "runnable":
      return item.availability === "runnable";
    case "recent":
      return (
        item.lastReviewed !== null && now - Date.parse(item.lastReviewed) < 24 * 3_600_000
      );
    default:
      return true;
  }
}

/**
 * A card answers, in order: what is it, what does it help me do, is it ready,
 * when was it last checked, what can I do next. One status label, one primary
 * action.
 */
function AssetCard({ item, now }: { item: MarketplaceItem; now: number }) {
  const readiness = readinessFor(item.trust.band);
  const needsInvestigation = readiness.key === "not_ready" || readiness.key === "checks_needed";
  const runnable = item.availability === "runnable";

  return (
    <article className="asset-card" data-asset-version-id={item.assetVersionId}>
      {/* 1. What is it */}
      <div className="asset-card__top">
        <div className="asset-card__title">
          <h3>
            <Link href={`/assets/${item.assetVersionId}`}>{item.name}</Link>
          </h3>
          <p className="asset-card__type">
            {item.assetType} · for {item.audiences[0] ?? "any team"}
          </p>
        </div>
        <TrustRing trust={item.trust} size="md" showMeta={false} />
      </div>

      {/* 2. What does it help me do */}
      <p className="asset-card__summary">{item.summary}</p>

      {/* 3. Is it ready, and 4. when was it last checked */}
      <div className="asset-card__meta">
        <span
          className={`pill pill--${
            readiness.tone === "positive"
              ? "success"
              : readiness.tone === "info"
                ? "info"
                : readiness.tone === "warning"
                  ? "warning"
                  : "danger"
          }`}
        >
          <span className="pill__dot" />
          {readiness.label}
        </span>
        {runnable ? (
          <span className="pill pill--brand">
            <IconRun style={{ width: 11, height: 11 }} />
            Can be run here
          </span>
        ) : null}
        <span>{relativeTime(item.lastReviewed, now)}</span>
      </div>

      {/* 5. What can I do next */}
      <div className="asset-card__foot">
        <Link className="btn btn--sm" href={`/assets/${item.assetVersionId}`}>
          View asset
        </Link>
        <InvestigateButton
          assetVersionId={item.assetVersionId}
          assetName={item.name}
          label={needsInvestigation ? "Why it needs attention" : "Check readiness"}
        />
      </div>
    </article>
  );
}

export function MarketplaceBrowser({
  items,
  initialView = "all",
  now = Date.now(),
}: {
  items: MarketplaceItem[];
  initialView?: View;
  now?: number;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(initialView);
  const [domain, setDomain] = useState("");
  const [sort, setSort] = useState<Sort>("trust_desc");

  const domains = useMemo(
    () => [...new Set(items.flatMap((item) => item.domains))].sort(),
    [items],
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(
        VIEWS.map(({ key }) => [
          key,
          items.filter((item) => matchesView(item, key, now)).length,
        ]),
      ) as Record<View, number>,
    [items, now],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (!matchesView(item, view, now)) return false;
      if (domain && !item.domains.includes(domain)) return false;
      if (!needle) return true;
      return [item.name, item.summary, item.owner, ...item.domains, ...item.audiences]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    return filtered.sort((left, right) => {
      switch (sort) {
        case "trust_asc":
          return left.trust.score - right.trust.score;
        case "name":
          return left.name.localeCompare(right.name);
        case "recent":
          return String(right.lastReviewed ?? "").localeCompare(String(left.lastReviewed ?? ""));
        default:
          return right.trust.score - left.trust.score;
      }
    });
  }, [items, query, view, domain, sort, now]);

  const filtersActive = query.trim() !== "" || view !== "all" || domain !== "";

  function clearFilters() {
    setQuery("");
    setView("all");
    setDomain("");
  }

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <IconDiscovery className="search__icon" />
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, team, or topic"
            aria-label="Search assets"
          />
        </div>
        <select
          className="select"
          style={{ width: "auto", minWidth: 150 }}
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          aria-label="Filter by topic"
        >
          <option value="">All topics</option>
          {domains.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: "auto", minWidth: 150 }}
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
          aria-label="Sort assets"
        >
          <option value="trust_desc">Most ready first</option>
          <option value="trust_asc">Needs most attention first</option>
          <option value="recent">Checked most recently</option>
          <option value="name">Name (A–Z)</option>
        </select>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Filter assets">
          {VIEWS.map(({ key, label }) => (
            <button
              className="segmented__btn"
              type="button"
              key={key}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {label}
              <span className="segmented__count">{counts[key]}</span>
            </button>
          ))}
        </div>
        {filtersActive ? (
          <button className="btn btn--sm btn--tertiary" type="button" onClick={clearFilters}>
            <IconFilter className="btn__icon" />
            Clear filters
          </button>
        ) : null}
      </div>

      <p className="result-count" role="status">
        Showing {visible.length} of {items.length} assets
      </p>

      {visible.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <IconEmpty style={{ width: 20, height: 20 }} />
          </span>
          <h3>Nothing matches these filters</h3>
          <p>
            Try a broader search, or clear the filters to see all {items.length} assets. If
            nothing here fits, that may be worth building.
          </p>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <button className="btn btn--sm" type="button" onClick={clearFilters}>
              Clear filters
            </button>
            <Link className="btn btn--sm btn--secondary" href="/contribute">
              Share a new asset
            </Link>
          </div>
        </div>
      ) : (
        <div className="asset-grid">
          {visible.map((item) => (
            <AssetCard item={item} now={now} key={item.assetVersionId} />
          ))}
        </div>
      )}
    </>
  );
}

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { demoCatalogEntries, heroDraftRecord } from "../../fixtures/catalog/published-catalog";
import ErrorState from "@/app/error";
import LoadingState from "@/app/loading";
import {
  MarketplaceBrowser,
  type MarketplaceItem,
} from "@/components/marketplace/marketplace-browser";
import { TrustBreakdown, TrustRing } from "@/components/ui/trust-ring";
import { buildGovernanceProjection } from "@/modules/governance";
import { computeTrustScore } from "@/modules/investigation";

function itemFor(index: number): MarketplaceItem {
  const entry = demoCatalogEntries[index]!;
  const version = entry.record.asset_version;
  const trust = computeTrustScore(buildGovernanceProjection(entry.record, []));
  return {
    assetVersionId: version.asset_version_id,
    name: version.name,
    summary: version.summary,
    owner: version.owner,
    assetType: version.asset_type,
    availability: version.availability,
    version: version.version,
    domains: version.domains,
    audiences: version.audiences,
    trust,
    lastReviewed: null,
    blockingGates: [],
  };
}

describe("marketplace presentation", () => {
  it("renders an asset card with its trust score and no Try control for a reference asset", () => {
    const item = itemFor(0);
    const markup = renderToStaticMarkup(
      createElement(MarketplaceBrowser, { items: [item] }),
    );

    expect(markup).toContain(item.name);
    // One status label, in plain words, never an internal grade.
    expect(markup).toMatch(/Ready to use|Ready with review|Checks needed|Not ready to use/);
    expect(markup).toContain(`href="/assets/${item.assetVersionId}"`);
    expect(markup).toMatch(/Trust \d+ out of 100/);
    expect(markup).not.toMatch(/>\s*Try\b/i);
  });

  it("labels a trust score as derived from gate coverage, never as an opinion", () => {
    const trust = computeTrustScore(buildGovernanceProjection(heroDraftRecord, []));
    const ring = renderToStaticMarkup(createElement(TrustRing, { trust }));
    const breakdown = renderToStaticMarkup(createElement(TrustBreakdown, { trust }));

    expect(ring).toContain("gates passing");
    expect(ring).toMatch(/aria-label="Trust \d+ out of 100/);
    for (const label of ["Governance", "Human review", "Evidence", "Security", "Freshness"]) {
      expect(breakdown).toContain(label);
    }
  });

  it("explains an empty result set and offers a recovery action", () => {
    const markup = renderToStaticMarkup(
      createElement(MarketplaceBrowser, { items: [], initialView: "all" }),
    );

    expect(markup).toContain("Nothing matches these filters");
    expect(markup).toContain("Clear filters");
  });

  it("renders truthful loading and recoverable error states", () => {
    const loading = renderToStaticMarkup(createElement(LoadingState));
    const error = renderToStaticMarkup(
      createElement(ErrorState, { error: new Error("fixture"), reset: () => undefined }),
    );

    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain("skeleton");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Try again");
    expect(error).not.toContain("fixture");
  });
});

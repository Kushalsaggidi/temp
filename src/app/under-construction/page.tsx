import type { Metadata } from "next";

import {
  MarketplaceBrowser,
  type MarketplaceItem,
} from "@/components/marketplace/marketplace-browser";
import { needsAttention } from "@/components/marketplace/needs-attention";
import { AppShell } from "@/components/shell/app-shell";
import { listPublishedTrustSummaries } from "@/modules/investigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Under construction",
  description: "Published assets that still need checks before they belong in the Marketplace.",
};

export default async function UnderConstructionPage() {
  const now = new Date();
  const summaries = await listPublishedTrustSummaries(undefined, now);

  const items: MarketplaceItem[] = summaries
    .map(({ record, trust, last_reviewed, blocking_gates }) => {
      const version = record.asset_version;
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
        lastReviewed: last_reviewed,
        blockingGates: blocking_gates,
      };
    })
    .filter((item) => needsAttention(item));

  return (
    <AppShell area="under-construction" crumbs={[{ label: "Under construction" }]}>
      <header className="page-head">
        <h1>Under construction</h1>
        <p>
          Published assets that still need checks before they are ready for the Marketplace.
        </p>
      </header>
      <MarketplaceBrowser items={items} now={now.getTime()} />
    </AppShell>
  );
}

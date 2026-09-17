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
  title: "Marketplace",
  description: "Browse published AI tools and templates and see which are ready to use.",
};

const VIEWS = ["all", "reviewed", "runnable", "recent"] as const;
type View = (typeof VIEWS)[number];

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
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
    // Assets needing attention now live on the dedicated Under construction page.
    .filter((item) => !needsAttention(item));

  const initialView: View = VIEWS.includes(view as View) ? (view as View) : "all";

  return (
    <AppShell area="marketplace" crumbs={[{ label: "Marketplace" }]}>
      <header className="page-head">
        <h1>Marketplace</h1>
        <p>
          Everything published, with how ready each one is and when it was last checked, so
          you can tell at a glance what you can use today.
        </p>
      </header>
      <MarketplaceBrowser items={items} initialView={initialView} now={now.getTime()} />
    </AppShell>
  );
}

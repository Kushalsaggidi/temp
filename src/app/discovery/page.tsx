import type { Metadata } from "next";

import { DiscoveryPanel } from "@/components/discovery/discovery-panel";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discovery",
  description: "Describe the work you need and find published assets that already cover it.",
};

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  return (
    <AppShell area="discovery" crumbs={[{ label: "Discovery" }]}>
      <header className="page-head">
        <h1>Tell us what you need</h1>
        <p>
          Describe the job in your own words. We will look through everything that is
          already published and show you why each result matched.
        </p>
      </header>
      <DiscoveryPanel initialQuery={q ?? ""} />
    </AppShell>
  );
}

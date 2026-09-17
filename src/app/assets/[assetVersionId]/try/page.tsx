import Link from "next/link";
import { notFound } from "next/navigation";

import { InvestigateButton } from "@/components/investigation/investigate-button";
import { ReuseEvidenceComparison } from "@/components/execution/reuse-evidence-comparison";
import { TryResultProvenance } from "@/components/execution/try-result-provenance";
import { SetAiContext } from "@/components/operator/context";
import { AppShell } from "@/components/shell/app-shell";
import { AssetVersionIdSchema } from "@/contracts";
import { withCatalogService } from "@/modules/catalog";
import { loadPersistedReuseComparison } from "@/modules/execution/reuse-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TryAssetPage({
  params,
}: {
  params: Promise<{ assetVersionId: string }>;
}) {
  const { assetVersionId } = await params;
  const parsedId = AssetVersionIdSchema.safeParse(assetVersionId);
  if (!parsedId.success) notFound();

  const record = await withCatalogService((service) =>
    service.getAdminVersionById(parsedId.data),
  );
  if (!record) notFound();

  const { asset, asset_version: version } = record;
  const publiclyRunnable =
    version.lifecycle === "published" &&
    version.deprecated_at === null &&
    asset.current_published_version_id === version.asset_version_id &&
    version.availability === "runnable" &&
    version.executor_key !== undefined &&
    version.definition_digest !== undefined;

  if (!publiclyRunnable) notFound();

  const reuseComparison = loadPersistedReuseComparison(version);

  return (
    <AppShell
      area="marketplace"
      wide
      crumbs={[
        { label: "Marketplace", href: "/marketplace" },
        { label: version.name, href: `/assets/${version.asset_version_id}` },
        { label: "Run" },
      ]}
      actions={
        <InvestigateButton
          assetVersionId={version.asset_version_id}
          assetName={version.name}
          label="Check readiness"
        />
      }
    >
      <SetAiContext
        surface="execution"
        label={`Run — ${version.name}`}
        assetVersionId={version.asset_version_id}
        assetName={version.name}
      />
      <header className="page-head">
        <h1>Try {version.name}</h1>
        <p>
          Enter your own details and see what it produces. Nothing is sent anywhere else,
          and every run is saved so you can check exactly what produced the result.
        </p>
      </header>

      <TryResultProvenance
        assetName={version.name}
        assetVersionId={version.asset_version_id}
      />

      <section className="section">
        <div className="section__head">
          <h2>Has this worked for other jobs?</h2>
          <p>The same asset, unchanged, used for two different jobs.</p>
          <Link className="section__link" href={`/governance/${version.asset_version_id}`}>
            See every check
          </Link>
        </div>
        <ReuseEvidenceComparison comparison={reuseComparison} />
      </section>
    </AppShell>
  );
}

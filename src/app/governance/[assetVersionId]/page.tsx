import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GovernanceActions } from "@/components/governance/governance-actions";
import { GovernancePanel } from "@/components/governance/governance-panel";
import { InvestigateButton } from "@/components/investigation/investigate-button";
import { SetAiContext } from "@/components/operator/context";
import { AppShell } from "@/components/shell/app-shell";
import { AssetVersionIdSchema } from "@/contracts";
import { GovernanceError, withGovernanceService } from "@/modules/governance";
import { computeTrustScore } from "@/modules/investigation";

export const metadata: Metadata = {
  title: "Governance record",
  robots: { index: false, follow: false },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function GovernanceRecordPage({
  params,
}: {
  params: Promise<{ assetVersionId: string }>;
}) {
  const { assetVersionId } = await params;
  const parsed = AssetVersionIdSchema.safeParse(assetVersionId);
  if (!parsed.success) notFound();

  let detail;
  try {
    detail = await withGovernanceService((service) => service.getDetail(parsed.data));
  } catch (error) {
    if (error instanceof GovernanceError && error.status === 404) notFound();
    throw error;
  }

  const version = detail.record.asset_version;
  const trust = computeTrustScore(detail.projection);

  return (
    <AppShell
      area="governance"
      wide
      crumbs={[{ label: "Governance", href: "/governance" }, { label: version.name }]}
      actions={
        <InvestigateButton
          assetVersionId={version.asset_version_id}
          assetName={version.name}
          variant="primary"
          label="Check readiness"
        />
      }
    >
      <SetAiContext
        surface="governance"
        label={`Governance — ${version.name}`}
        assetVersionId={version.asset_version_id}
        assetName={version.name}
      />
      <div className="detail">
        <GovernancePanel detail={detail} trust={trust} />
        <div className="detail__aside">
          <GovernanceActions
            assetVersionId={version.asset_version_id}
            lifecycle={version.lifecycle}
            canPublish={detail.projection.canPublish}
            runnable={version.availability === "runnable"}
            prototypeLimitation={detail.prototype_limitation}
          />
        </div>
      </div>
    </AppShell>
  );
}

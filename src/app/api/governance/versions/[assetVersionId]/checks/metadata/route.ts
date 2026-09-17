import { AssetVersionIdSchema } from "@/contracts";
import { GovernanceError, withGovernanceService } from "@/modules/governance";

import {
  governanceHeaders,
  handleGovernanceRequest,
} from "../../../../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assetVersionId: string }> };

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleGovernanceRequest(async () => {
    const { assetVersionId } = await context.params;
    const parsed = AssetVersionIdSchema.safeParse(assetVersionId);
    if (!parsed.success) {
      throw new GovernanceError(400, "invalid_asset_version_id", "Invalid asset version ID.");
    }
    const evidence = await withGovernanceService((service) =>
      service.runMetadataValidation(parsed.data),
    );
    return Response.json(evidence, { status: 201, headers: governanceHeaders });
  });
}

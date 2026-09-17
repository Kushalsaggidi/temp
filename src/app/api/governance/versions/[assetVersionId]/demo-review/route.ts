import { AssetVersionIdSchema } from "@/contracts";
import { GovernanceError, withGovernanceService } from "@/modules/governance";

import {
  governanceHeaders,
  handleGovernanceRequest,
  readGovernanceJson,
} from "../../../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assetVersionId: string }> };

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleGovernanceRequest(async () => {
    const { assetVersionId } = await context.params;
    const parsed = AssetVersionIdSchema.safeParse(assetVersionId);
    if (!parsed.success) {
      throw new GovernanceError(400, "invalid_asset_version_id", "Invalid asset version ID.");
    }
    const body = await readGovernanceJson(request);
    const evidence = await withGovernanceService((service) =>
      service.recordDemoReview(parsed.data, body),
    );
    return Response.json(
      {
        evidence,
        prototype_limitation:
          "No authentication is present; the entered reviewer identity is not verified.",
      },
      { status: 201, headers: governanceHeaders },
    );
  });
}


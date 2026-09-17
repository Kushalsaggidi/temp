import { AssetVersionIdSchema } from "@/contracts";
import { GovernanceError, withGovernanceService } from "@/modules/governance";

import {
  governanceHeaders,
  handleGovernanceRequest,
} from "../../../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assetVersionId: string }> };

/**
 * Locks an editable version's content by computing and storing its subject
 * digest. Evidence can only be collected against a frozen subject, so this is
 * the step that turns a draft into something reviewable.
 */
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
    const record = await withGovernanceService((service) =>
      service.freezeVersion(parsed.data),
    );
    return Response.json(record, { status: 200, headers: governanceHeaders });
  });
}

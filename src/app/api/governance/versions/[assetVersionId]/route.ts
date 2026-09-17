import { AssetVersionIdSchema } from "@/contracts";
import { GovernanceError, withGovernanceService } from "@/modules/governance";

import {
  governanceHeaders,
  handleGovernanceRequest,
  readGovernanceJson,
} from "../../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assetVersionId: string }> };

async function versionId(context: RouteContext): Promise<string> {
  const { assetVersionId } = await context.params;
  const parsed = AssetVersionIdSchema.safeParse(assetVersionId);
  if (!parsed.success) {
    throw new GovernanceError(400, "invalid_asset_version_id", "Invalid asset version ID.");
  }
  return parsed.data;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleGovernanceRequest(async () => {
    const id = await versionId(context);
    const detail = await withGovernanceService((service) => service.getDetail(id));
    return Response.json(detail, { headers: governanceHeaders });
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleGovernanceRequest(async () => {
    const id = await versionId(context);
    const body = await readGovernanceJson(request);
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      !("content" in body)
    ) {
      throw new GovernanceError(
        422,
        "invalid_edit_request",
        "Provide the complete edited version content.",
      );
    }
    const record = await withGovernanceService((service) =>
      service.updateEditableDraft(id, body.content),
    );
    return Response.json(record, { headers: governanceHeaders });
  });
}


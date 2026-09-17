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
    const detail = await withGovernanceService((service) =>
      versionId(context).then((id) => service.getDetail(id)),
    );
    return Response.json(
      { evidence: detail.evidence, history: detail.history },
      { headers: governanceHeaders },
    );
  });
}

export async function POST(
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
      !("evidence_type" in body) ||
      !["functional_test", "guardrail_test", "reuse_test"].includes(
        String(body.evidence_type),
      ) ||
      !("actor_type" in body) ||
      body.actor_type !== "system"
    ) {
      throw new GovernanceError(
        422,
        "evidence_ingestion_not_allowed",
        "This endpoint accepts system-produced functional, guardrail, or reuse evidence only. Use deterministic metadata validation or the explicitly labeled demo-review action for human outcomes.",
      );
    }
    const evidence = await withGovernanceService((service) =>
      service.recordEvidence(id, body),
    );
    return Response.json(evidence, { status: 201, headers: governanceHeaders });
  });
}

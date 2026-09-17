import { MetadataAssistanceService, GovernanceError } from "@/modules/governance";
import { GeminiMetadataAssistanceAdapter } from "@/modules/governance/metadata-ai";

import {
  governanceHeaders,
  handleGovernanceRequest,
  readGovernanceJson,
} from "../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleGovernanceRequest(async () => {
    const body = await readGovernanceJson(request);
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      !("metadata" in body) ||
      typeof body.metadata !== "object" ||
      body.metadata === null ||
      Array.isArray(body.metadata)
    ) {
      throw new GovernanceError(
        422,
        "invalid_metadata_assistance_request",
        "Provide a metadata object to inspect.",
      );
    }
    const result = await new MetadataAssistanceService(
      new GeminiMetadataAssistanceAdapter(),
    ).inspect({
      metadata: body.metadata as Record<string, unknown>,
    });
    return Response.json(result, { headers: governanceHeaders });
  });
}


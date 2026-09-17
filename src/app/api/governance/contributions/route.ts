import { withGovernanceService } from "@/modules/governance";

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
    const record = await withGovernanceService((service) =>
      service.createContribution(body),
    );
    return Response.json(record, { status: 201, headers: governanceHeaders });
  });
}


import { withGovernanceService } from "@/modules/governance";

import { governanceHeaders, handleGovernanceRequest } from "../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleGovernanceRequest(async () => {
    const items = await withGovernanceService((service) => service.listQueue());
    return Response.json(
      { items, count: items.length },
      { headers: governanceHeaders },
    );
  });
}


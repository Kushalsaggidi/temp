import { AssetVersionIdSchema, ImpactActionKeySchema } from "@/contracts";
import { loadAlternatives, loadImpactGraph, loadImpactPreview } from "@/modules/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" } as const;

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/**
 * One read-only endpoint for the three drawer panels. Each view is a deterministic
 * projection of persisted state, so they share a cache policy and an error shape.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetVersionId: string }> },
): Promise<Response> {
  const { assetVersionId } = await params;
  const parsed = AssetVersionIdSchema.safeParse(assetVersionId);
  if (!parsed.success) {
    return fail(400, "invalid_asset_version_id", "Invalid asset version identifier.");
  }

  const view = new URL(request.url).searchParams.get("view");

  try {
    if (view === "graph") {
      const graph = loadImpactGraph(parsed.data);
      return graph === null
        ? fail(404, "asset_version_not_found", "Asset version not found.")
        : Response.json(graph, { headers });
    }

    if (view === "alternatives") {
      const alternatives = loadAlternatives(parsed.data);
      return alternatives === null
        ? fail(404, "asset_version_not_found", "Asset version not found.")
        : Response.json(alternatives, { headers });
    }

    if (view === "impact") {
      const action = ImpactActionKeySchema.safeParse(
        new URL(request.url).searchParams.get("action"),
      );
      if (!action.success) {
        return fail(400, "invalid_action", "Unknown action for an impact preview.");
      }
      const preview = loadImpactPreview(parsed.data, action.data);
      return preview === null
        ? fail(404, "asset_version_not_found", "Asset version not found.")
        : Response.json(preview, { headers });
    }

    return fail(400, "invalid_view", "Specify view=graph, view=alternatives, or view=impact.");
  } catch {
    return fail(
      500,
      "insight_failed",
      "The requested view could not be produced. No conclusion was shown.",
    );
  }
}

import { AssetVersionIdSchema } from "@/contracts";
import { investigateAssetVersion } from "@/modules/investigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetVersionId: string }> },
): Promise<Response> {
  const { assetVersionId } = await params;
  const parsed = AssetVersionIdSchema.safeParse(assetVersionId);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_asset_version_id", message: "Invalid asset version identifier." } },
      { status: 400, headers },
    );
  }

  try {
    const report = await investigateAssetVersion(parsed.data);
    if (report === null) {
      return Response.json(
        { error: { code: "asset_version_not_found", message: "Asset version not found." } },
        { status: 404, headers },
      );
    }
    return Response.json(report, { headers });
  } catch {
    return Response.json(
      {
        error: {
          code: "investigation_failed",
          message: "The investigation could not be completed. No conclusion was produced.",
        },
      },
      { status: 500, headers },
    );
  }
}

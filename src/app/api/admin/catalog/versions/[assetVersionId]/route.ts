import {
  AdminCatalogVersionResponseSchema,
  AssetVersionIdSchema,
} from "@/contracts";
import { withCatalogService } from "@/modules/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ assetVersionId: string }>;
};

const errorResponse = (
  status: number,
  code: string,
  message: string,
): Response =>
  Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { assetVersionId } = await context.params;
  const parsedId = AssetVersionIdSchema.safeParse(assetVersionId);

  if (!parsedId.success) {
    return errorResponse(400, "invalid_asset_version_id", "Invalid asset version ID.");
  }

  const record = await withCatalogService((service) =>
    service.getAdminVersionById(parsedId.data),
  );

  if (record === null) {
    return errorResponse(404, "asset_version_not_found", "Asset version not found.");
  }

  const payload = AdminCatalogVersionResponseSchema.parse(record);
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}


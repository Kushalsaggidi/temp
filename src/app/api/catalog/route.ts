import { CatalogListResponseSchema } from "@/contracts";
import { withCatalogService } from "@/modules/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const payload = await withCatalogService(async (service) => {
    const items = await service.listPublished();
    return CatalogListResponseSchema.parse({ items, count: items.length });
  });

  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

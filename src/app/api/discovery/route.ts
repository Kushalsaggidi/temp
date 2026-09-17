import { DiscoveryRequestSchema } from "@/contracts";
import { withCatalogService } from "@/modules/catalog";
import { discover } from "@/modules/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function invalidRequest(): Response {
  return Response.json(
    { error: "Invalid discovery request." },
    { status: 400, headers: noStore },
  );
}

export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return invalidRequest();
  }

  const validated = DiscoveryRequestSchema.safeParse(input);
  if (!validated.success) return invalidRequest();

  try {
    const result = await withCatalogService((service) =>
      discover(validated.data, service.listPublished()));
    return Response.json(result, { headers: noStore });
  } catch {
    return Response.json(
      { error: "Discovery is temporarily unavailable." },
      { status: 503, headers: noStore },
    );
  }
}

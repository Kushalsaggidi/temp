import { assertExecutionRuntimeReady } from "@/modules/execution/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    assertExecutionRuntimeReady();
  } catch {
    return Response.json(
      {
        status: "unavailable",
        service: "ai-marketplace",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  return Response.json(
    {
      status: "ok",
      service: "ai-marketplace",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

import { z } from "zod";

import { CatalogRepository } from "@/modules/catalog/repository";
import { normalizeIntent, retrievePublished } from "@/modules/discovery";
import { closeDatabase, openDatabase } from "@/server/db/connection";
import { migrateDatabase } from "@/server/db/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" } as const;

const RequestSchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    summary: z.string().trim().max(600).optional(),
    capabilities: z.array(z.string().trim().min(1)).max(20).optional(),
    use_cases: z.array(z.string().trim().min(1)).max(20).optional(),
    domain: z.string().trim().max(200).optional(),
    audience: z.string().trim().max(200).optional(),
  })
  .strict();

/** Overlap strong enough to be worth showing a contributor before they build. */
const SIMILARITY_FLOOR = 0.1;

/**
 * Checks a draft contribution against the published catalog using the same
 * deterministic ranker discovery uses. It only reports overlap; it never blocks
 * a contribution or decides anything on the contributor's behalf.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400, headers },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_request", message: "Unexpected duplicate-check input." } },
      { status: 400, headers },
    );
  }

  const { name, summary, capabilities = [], use_cases = [], domain, audience } = parsed.data;
  const queryText = [name, summary, ...capabilities, ...use_cases]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(". ")
    .trim();

  if (queryText.length < 12) {
    return Response.json({ candidates: [], query_terms: 0 }, { headers });
  }

  const database = openDatabase();
  try {
    migrateDatabase(database);
    const records = new CatalogRepository(database).listPublished();
    const intent = normalizeIntent({
      query: queryText,
      ...(domain || audience
        ? {
            optional_context: {
              ...(domain ? { domain } : {}),
              ...(audience ? { audience } : {}),
            },
          }
        : {}),
    });
    const first = intent.intents[0];
    if (!first) return Response.json({ candidates: [], query_terms: 0 }, { headers });

    const candidates = retrievePublished(records, first, audience ? { audience } : {})
      .filter((candidate) => candidate.score >= SIMILARITY_FLOOR)
      .slice(0, 4)
      .map((candidate) => ({
        asset_version_id: candidate.record.asset_version.asset_version_id,
        name: candidate.record.asset_version.name,
        summary: candidate.record.asset_version.summary,
        owner: candidate.record.asset_version.owner,
        overlap: Math.min(99, Math.round(candidate.score * 100)),
        matched_fields: candidate.evidence.map((item) => item.field),
      }));

    return Response.json({ candidates, query_terms: queryText.length }, { headers });
  } catch {
    return Response.json(
      {
        error: {
          code: "duplicate_check_failed",
          message: "The catalog could not be checked for overlapping assets.",
        },
      },
      { status: 500, headers },
    );
  } finally {
    closeDatabase(database);
  }
}

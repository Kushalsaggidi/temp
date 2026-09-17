import { z } from "zod";

/**
 * The operator's single model boundary. It is deliberately narrow: the model
 * may choose which existing capability to call and name the entity it refers
 * to, and it may draft contribution metadata a human then edits and approves.
 * It never produces a marketplace fact, a score, a gate outcome, or a decision.
 * Every failure mode falls back to the deterministic router.
 */
export const OPERATOR_MODEL = "gemini-3.5-flash-lite";

const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_ATTEMPTS = 2;

type Fetcher = typeof fetch;

export interface OperatorAdapterOptions {
  enabled?: boolean;
  apiKey?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

export interface OperatorRouteInput {
  utterance: string;
  surface: string;
  contextLabel: string;
  contextAssetName: string | null;
  tools: readonly { name: string; kind: string; summary: string }[];
  /** Published assets the request could plausibly refer to, name only. */
  candidates: readonly { asset_version_id: string; name: string }[];
}

const RouteSchema = z
  .object({
    tool: z.string().trim().min(1).max(60),
    /** Empty string means "use the asset already in context". */
    asset_reference: z.string().trim().max(200),
    second_asset_reference: z.string().trim().max(200),
    query: z.string().trim().max(400),
    intent: z.string().trim().min(1).max(80),
    interpretation: z.string().trim().min(1).max(300),
  })
  .strict();

export type OperatorRoute = z.infer<typeof RouteSchema>;

export type OperatorAdapterResult<T> =
  | { state: "ready"; output: T; modelOrConfig: string }
  | { state: "disabled" | "unavailable"; reason: string };

const DraftSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    summary: z.string().trim().min(1).max(400),
    description: z.string().trim().min(1).max(2_000),
    capabilities: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
    use_cases: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
    domains: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
    audiences: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
    limitations: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
    usage_instructions: z.string().trim().min(1).max(1_500),
    setup_expectations: z.string().trim().min(1).max(1_000),
    maintenance_expectations: z.string().trim().min(1).max(1_000),
  })
  .strict();

export type ContributionDraftOutput = z.infer<typeof DraftSchema>;

function configuredTimeout(value: number | undefined): number {
  if (value !== undefined) return Math.min(10_000, Math.max(500, value));
  const fromEnvironment = Number(process.env.DISCOVERY_AI_TIMEOUT_MS);
  return Number.isFinite(fromEnvironment)
    ? Math.min(10_000, Math.max(500, fromEnvironment * 1.5))
    : DEFAULT_TIMEOUT_MS;
}

function readCandidateText(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("candidates" in body)) return null;
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = (parts[0] as { text?: unknown }).text;
  return typeof text === "string" && text.trim().length > 0 ? text : null;
}

const ROUTE_RULES = [
  "You route a request inside an internal AI asset marketplace to exactly one existing capability.",
  "Choose the single tool whose summary best matches what the person asked for.",
  "asset_reference: the asset the person means, by name or identifier. Return an empty string when they said 'this', 'it', or named nothing and an asset is already in context.",
  "second_asset_reference: only for a comparison between two named assets; otherwise an empty string.",
  "query: the search text, only for a search. Otherwise an empty string.",
  "intent: two or three words naming what they want, lowercase.",
  "interpretation: one short sentence restating the request. State no fact about any asset.",
  "Never invent an asset, a score, a check outcome, a person, or a date.",
  "Return JSON matching the supplied schema and no prose.",
].join("\n");

const DRAFT_RULES = [
  "You draft catalogue metadata for a proposed internal AI marketplace asset, from the person's own description.",
  "This is a draft a human will review, edit, and approve. It is never published by you.",
  "Write plainly and specifically. Do not claim any review, approval, certification, accuracy figure, or customer outcome.",
  "Do not name a real customer, employee, system of record, or dataset.",
  "limitations must state honest boundaries of the proposed asset.",
  "slug must be lowercase kebab-case derived from the name.",
  "Return JSON matching the supplied schema and no prose.",
].join("\n");

export class GeminiOperatorAdapter {
  readonly enabled: boolean;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetcher: Fetcher;

  constructor(options: OperatorAdapterOptions = {}) {
    this.enabled = options.enabled ?? process.env.AI_PROVIDER === "gemini";
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.timeoutMs = configuredTimeout(options.timeoutMs);
    this.fetcher = options.fetcher ?? fetch;
  }

  async route(input: OperatorRouteInput): Promise<OperatorAdapterResult<OperatorRoute>> {
    const payload = {
      request: input.utterance,
      current_surface: input.surface,
      current_context: input.contextLabel,
      asset_in_context: input.contextAssetName,
      available_tools: input.tools.map((tool) => ({
        name: tool.name,
        kind: tool.kind,
        does: tool.summary,
      })),
      known_asset_names: input.candidates.map((candidate) => candidate.name),
    };

    return this.call(
      `${ROUTE_RULES}\n\n${JSON.stringify(payload)}`,
      {
        type: "OBJECT",
        properties: {
          tool: {
            type: "STRING",
            enum: input.tools.map((tool) => tool.name),
          },
          asset_reference: { type: "STRING" },
          second_asset_reference: { type: "STRING" },
          query: { type: "STRING" },
          intent: { type: "STRING" },
          interpretation: { type: "STRING" },
        },
        required: [
          "tool",
          "asset_reference",
          "second_asset_reference",
          "query",
          "intent",
          "interpretation",
        ],
      },
      RouteSchema,
      0,
    );
  }

  async draftContribution(
    description: string,
    knownDomains: readonly string[],
  ): Promise<OperatorAdapterResult<ContributionDraftOutput>> {
    const payload = {
      description,
      domains_already_used_in_this_catalogue: knownDomains.slice(0, 12),
    };
    const listOfStrings = { type: "ARRAY", items: { type: "STRING" } };
    return this.call(
      `${DRAFT_RULES}\n\n${JSON.stringify(payload)}`,
      {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          slug: { type: "STRING" },
          summary: { type: "STRING" },
          description: { type: "STRING" },
          capabilities: listOfStrings,
          use_cases: listOfStrings,
          domains: listOfStrings,
          audiences: listOfStrings,
          limitations: listOfStrings,
          usage_instructions: { type: "STRING" },
          setup_expectations: { type: "STRING" },
          maintenance_expectations: { type: "STRING" },
        },
        required: [
          "name",
          "slug",
          "summary",
          "description",
          "capabilities",
          "use_cases",
          "domains",
          "audiences",
          "limitations",
          "usage_instructions",
          "setup_expectations",
          "maintenance_expectations",
        ],
      },
      DraftSchema,
      0.3,
    );
  }

  private async call<T>(
    prompt: string,
    responseSchema: Record<string, unknown>,
    schema: z.ZodType<T>,
    temperature: number,
  ): Promise<OperatorAdapterResult<T>> {
    if (!this.enabled) {
      return {
        state: "disabled",
        reason: "Optional AI is disabled; the deterministic router is used.",
      };
    }
    if (!this.apiKey) {
      return {
        state: "unavailable",
        reason:
          "Gemini is enabled but no API key is available; the deterministic router is used.",
      };
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${OPERATOR_MODEL}:generateContent`,
          {
            method: "POST",
            signal: controller.signal,
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature,
                responseMimeType: "application/json",
                responseSchema,
              },
            }),
          },
        );

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < MAX_ATTEMPTS) continue;
          return {
            state: "unavailable",
            reason: `The routing service returned HTTP ${response.status}; the deterministic router is used.`,
          };
        }

        const body: unknown = await response.json();
        const text = readCandidateText(body);
        if (text === null) {
          return {
            state: "unavailable",
            reason:
              "The routing service returned no usable content; the deterministic router is used.",
          };
        }

        let decoded: unknown;
        try {
          decoded = JSON.parse(text);
        } catch {
          return {
            state: "unavailable",
            reason:
              "The routing service returned malformed output; the deterministic router is used.",
          };
        }

        const parsed = schema.safeParse(decoded);
        if (!parsed.success) {
          return {
            state: "unavailable",
            reason:
              "The routing service returned an unsupported shape; the deterministic router is used.",
          };
        }
        return { state: "ready", output: parsed.data, modelOrConfig: OPERATOR_MODEL };
      } catch {
        if (attempt < MAX_ATTEMPTS) continue;
        return {
          state: "unavailable",
          reason:
            "The routing service was unreachable; the deterministic router is used.",
        };
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      state: "unavailable",
      reason: "The routing service did not respond; the deterministic router is used.",
    };
  }
}

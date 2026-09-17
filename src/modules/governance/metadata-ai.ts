import { z } from "zod";

import type { AiProviderResult, AiProviderState, OptionalAiProvider } from "@/shared/ports";

import type { MetadataAssistanceInput } from "./metadata-assistance";

export const METADATA_ASSISTANCE_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 5_000;

const OutputSchema = z
  .object({
    suggestions: z.array(z.string().trim().min(1).max(240)).max(6),
  })
  .strict();

type Fetcher = typeof fetch;

const RULES = [
  "You review draft metadata for an internal AI asset marketplace contribution.",
  "Suggest at most five short, concrete improvements to clarity, audience fit, or missing limitations.",
  "Each suggestion must be one sentence and must reference a field the contributor supplied.",
  "Never approve, publish, score, or claim the contribution is safe, reviewed, or compliant.",
  "Never invent a fact, owner, permission, or capability that is not in the supplied metadata.",
  "Return JSON matching the supplied schema and no prose.",
].join("\n");

/**
 * Optional reviewer assistance for contribution metadata. It can only suggest;
 * the deterministic findings and the human reviewer remain authoritative.
 */
export class GeminiMetadataAssistanceAdapter
  implements OptionalAiProvider<MetadataAssistanceInput, readonly string[]>
{
  readonly state: AiProviderState;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetcher: Fetcher;

  constructor(
    options: {
      enabled?: boolean;
      apiKey?: string;
      timeoutMs?: number;
      fetcher?: Fetcher;
    } = {},
  ) {
    const enabled = options.enabled ?? process.env.AI_PROVIDER === "gemini";
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher ?? fetch;
    this.state = enabled ? (this.apiKey ? "ready" : "unavailable") : "disabled";
  }

  async enhance(
    input: MetadataAssistanceInput,
  ): Promise<AiProviderResult<readonly string[]>> {
    if (this.state === "disabled") {
      return {
        state: "disabled",
        reason: "Optional AI is disabled; deterministic validation is shown on its own.",
      };
    }
    if (!this.apiKey) {
      return {
        state: "unavailable",
        reason: "Gemini is enabled but no API key is available; deterministic validation only.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${METADATA_ASSISTANCE_MODEL}:generateContent`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify({
            contents: [
              { parts: [{ text: `${RULES}\n\n${JSON.stringify(input.metadata)}` }] },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  suggestions: { type: "ARRAY", items: { type: "STRING" }, maxItems: 6 },
                },
                required: ["suggestions"],
              },
            },
          }),
        },
      );

      if (!response.ok) {
        return {
          state: "unavailable",
          reason: `The assistance service returned HTTP ${response.status}; deterministic validation only.`,
        };
      }

      const body: unknown = await response.json();
      const text = readCandidateText(body);
      if (text === null) {
        return {
          state: "unavailable",
          reason: "The assistance service returned no usable content; deterministic validation only.",
        };
      }
      const parsed = OutputSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        return {
          state: "unavailable",
          reason: "The suggestions did not match the required shape; deterministic validation only.",
        };
      }
      return {
        state: "ready",
        output: parsed.data.suggestions,
        modelOrConfig: METADATA_ASSISTANCE_MODEL,
      };
    } catch {
      return {
        state: "unavailable",
        reason: "The assistance service was unreachable; deterministic validation only.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
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

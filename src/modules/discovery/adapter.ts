import { z } from "zod";
import type { AiProviderResult, AiProviderState, OptionalAiProvider } from "@/shared/ports";
import type { InterpretedIntent } from "./normalization";

export const GEMINI_DISCOVERY_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_ATTEMPTS = 2;

export type SemanticEnhancementInput = {
  interpreted_intent: InterpretedIntent;
  audience?: string;
};

export type SemanticEnhancement = { additional_terms: string[] };

const OutputSchema = z.object({
  additional_terms: z.array(
    z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}\s-]+$/u),
  ).max(20),
}).strict();

type Fetcher = typeof fetch;

export type GeminiDiscoveryAdapterOptions = {
  enabled?: boolean;
  apiKey?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
};

function configuredTimeout(value: number | undefined): number {
  if (value !== undefined) return Math.min(10_000, Math.max(250, value));
  const fromEnvironment = Number(process.env.DISCOVERY_AI_TIMEOUT_MS);
  return Number.isFinite(fromEnvironment)
    ? Math.min(10_000, Math.max(250, fromEnvironment))
    : DEFAULT_TIMEOUT_MS;
}

/** The sole discovery-provider boundary. It can add query terms, never catalog facts. */
export class GeminiDiscoveryAdapter
  implements OptionalAiProvider<SemanticEnhancementInput, SemanticEnhancement>
{
  readonly state: AiProviderState;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetcher: Fetcher;

  constructor(options: GeminiDiscoveryAdapterOptions = {}) {
    const enabled = options.enabled ?? process.env.AI_PROVIDER === "gemini";
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.timeoutMs = configuredTimeout(options.timeoutMs);
    this.fetcher = options.fetcher ?? fetch;
    this.state = enabled ? (this.apiKey ? "ready" : "unavailable") : "disabled";
  }

  async enhance(
    input: SemanticEnhancementInput,
  ): Promise<AiProviderResult<SemanticEnhancement>> {
    if (this.state === "disabled") {
      return {
        state: "disabled",
        reason: "Optional AI is disabled; deterministic discovery used.",
      };
    }
    if (!this.apiKey) {
      return {
        state: "unavailable",
        reason: "Gemini is enabled but GEMINI_API_KEY is unavailable; deterministic discovery used.",
      };
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DISCOVERY_MODEL}:generateContent`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: [
                    "Extract only short search terms or conservative synonyms from this normalized marketplace discovery request.",
                    "Do not invent assets, fields, facts, permissions, lifecycle state, or recommendations.",
                    "Return JSON matching the supplied schema and no prose.",
                    JSON.stringify(input),
                  ].join("\n"),
                }],
              }],
              generationConfig: {
                temperature: 0,
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    additional_terms: {
                      type: "ARRAY",
                      items: { type: "STRING" },
                      maxItems: 20,
                    },
                  },
                  required: ["additional_terms"],
                },
              },
            }),
          },
        );

        const retryable = response.status === 429 || response.status >= 500;
        if (!response.ok) {
          if (retryable && attempt < MAX_ATTEMPTS) continue;
          return {
            state: "unavailable",
            reason: `Gemini provider returned HTTP ${response.status}; deterministic discovery used.`,
          };
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return {
            state: "unavailable",
            reason: "Gemini returned an unreadable response; deterministic discovery used.",
          };
        }

        const text = (body as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        }).candidates?.[0]?.content?.parts?.[0]?.text;
        let decoded: unknown;
        try {
          decoded = text === undefined ? null : JSON.parse(text);
        } catch {
          return {
            state: "unavailable",
            reason: "Gemini returned malformed structured output; deterministic discovery used.",
          };
        }

        const parsed = OutputSchema.safeParse(decoded);
        if (!parsed.success) {
          return {
            state: "unavailable",
            reason: "Gemini returned unsupported structured output; deterministic discovery used.",
          };
        }

        return {
          state: "ready",
          output: parsed.data,
          modelOrConfig: GEMINI_DISCOVERY_MODEL,
        };
      } catch {
        if (attempt < MAX_ATTEMPTS) continue;
        return {
          state: "unavailable",
          reason: "Gemini timed out or could not be reached; deterministic discovery used.",
        };
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      state: "unavailable",
      reason: "Gemini was unavailable; deterministic discovery used.",
    };
  }
}

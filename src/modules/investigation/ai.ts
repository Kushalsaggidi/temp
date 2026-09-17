import { z } from "zod";

import type { InvestigationInference, InvestigationInferenceProvider } from "./service";

export const INVESTIGATION_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_ATTEMPTS = 2;

const OutputSchema = z
  .object({
    inference: z.string().trim().min(1).max(600),
    recommendation: z.string().trim().min(1).max(600),
  })
  .strict();

type Fetcher = typeof fetch;

export interface GeminiInvestigationAdapterOptions {
  enabled?: boolean;
  apiKey?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

function configuredTimeout(value: number | undefined): number {
  if (value !== undefined) return Math.min(10_000, Math.max(500, value));
  const fromEnvironment = Number(process.env.DISCOVERY_AI_TIMEOUT_MS);
  return Number.isFinite(fromEnvironment)
    ? Math.min(10_000, Math.max(500, fromEnvironment * 1.5))
    : DEFAULT_TIMEOUT_MS;
}

const SYSTEM_RULES = [
  "You interpret a governance investigation for an internal AI asset marketplace.",
  "You receive only deterministic observations already computed from a database.",
  "Write one short inference explaining the most likely cause, and one short recommendation.",
  "Never state a fact that is not present in the observations.",
  "Never claim something was approved, verified, reviewed, or safe.",
  "Never name a person, team, date, metric, or identifier that is not in the observations.",
  "Use cautious language such as 'most likely' or 'suggests'. Two sentences maximum each.",
  "Return JSON matching the supplied schema and no prose.",
].join("\n");

/**
 * The sole investigation provider boundary. It can interpret and recommend; it
 * can never add, alter, or assert a governance fact, and every failure mode
 * falls back to the deterministic interpretation.
 */
export class GeminiInvestigationAdapter implements InvestigationInferenceProvider {
  private readonly enabled: boolean;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetcher: Fetcher;

  constructor(options: GeminiInvestigationAdapterOptions = {}) {
    this.enabled = options.enabled ?? process.env.AI_PROVIDER === "gemini";
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.timeoutMs = configuredTimeout(options.timeoutMs);
    this.fetcher = options.fetcher ?? fetch;
  }

  async infer(input: {
    assetName: string;
    severity: string;
    observations: string[];
    signals: { label: string; before: string; after: string }[];
    changedFields: string[];
  }): Promise<InvestigationInference> {
    const unavailable = (reason: string): InvestigationInference => ({
      inference: "",
      recommendation: "",
      state: "unavailable",
      modelOrConfig: null,
      reason,
    });

    if (!this.enabled) {
      return {
        inference: "",
        recommendation: "",
        state: "disabled",
        modelOrConfig: null,
        reason: "Optional AI is disabled; the deterministic interpretation is shown.",
      };
    }
    if (!this.apiKey) {
      return unavailable(
        "Gemini is enabled but no API key is available; the deterministic interpretation is shown.",
      );
    }

    const payload = {
      asset: input.assetName,
      severity: input.severity,
      observations: input.observations,
      signals: input.signals.map((signal) => ({
        signal: signal.label,
        before: signal.before,
        after: signal.after,
      })),
      changed_fields: input.changedFields,
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${INVESTIGATION_MODEL}:generateContent`,
          {
            method: "POST",
            signal: controller.signal,
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${SYSTEM_RULES}\n\n${JSON.stringify(payload)}` }] }],
              generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    inference: { type: "STRING" },
                    recommendation: { type: "STRING" },
                  },
                  required: ["inference", "recommendation"],
                },
              },
            }),
          },
        );

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < MAX_ATTEMPTS) continue;
          return unavailable(
            `The interpretation service returned HTTP ${response.status}; the deterministic interpretation is shown.`,
          );
        }

        const body: unknown = await response.json();
        const text = readCandidateText(body);
        if (text === null) {
          return unavailable(
            "The interpretation service returned no usable content; the deterministic interpretation is shown.",
          );
        }
        const parsed = OutputSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          return unavailable(
            "The interpretation did not match the required shape; the deterministic interpretation is shown.",
          );
        }
        return {
          inference: parsed.data.inference,
          recommendation: parsed.data.recommendation,
          state: "ready",
          modelOrConfig: INVESTIGATION_MODEL,
          reason: null,
        };
      } catch {
        if (attempt < MAX_ATTEMPTS) continue;
        return unavailable(
          "The interpretation service was unreachable; the deterministic interpretation is shown.",
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    return unavailable("The interpretation service did not respond; the deterministic interpretation is shown.");
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

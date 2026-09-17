import { describe, expect, it, vi } from "vitest";
import {
  GEMINI_DISCOVERY_MODEL,
  GeminiDiscoveryAdapter,
  type SemanticEnhancementInput,
} from "@/modules/discovery";

const input: SemanticEnhancementInput = {
  interpreted_intent: {
    intents: [{ goal: "notify occupants", constraints: [] }],
  },
};

function geminiResponse(output: string): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text: output }] } }],
  });
}

describe("Gemini discovery adapter", () => {
  it("keeps the credential out of the URL and validates structured output", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      geminiResponse('{"additional_terms":["resident communications"]}'));
    const adapter = new GeminiDiscoveryAdapter({
      enabled: true,
      apiKey: "test-secret-key",
      fetcher,
    });

    await expect(adapter.enhance(input)).resolves.toEqual({
      state: "ready",
      output: { additional_terms: ["resident communications"] },
      modelOrConfig: GEMINI_DISCOVERY_MODEL,
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).not.toContain("test-secret-key");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-secret-key");
  });

  it("rejects malformed or unsupported model output safely", async () => {
    const malformed = new GeminiDiscoveryAdapter({
      enabled: true,
      apiKey: "test-key",
      fetcher: async () => geminiResponse("not-json"),
    });
    await expect(malformed.enhance(input)).resolves.toMatchObject({
      state: "unavailable",
      reason: expect.stringContaining("malformed structured output"),
    });

    const unsupported = new GeminiDiscoveryAdapter({
      enabled: true,
      apiKey: "test-key",
      fetcher: async () => geminiResponse('{"additional_terms":["ok"],"asset_id":"invented"}'),
    });
    await expect(unsupported.enhance(input)).resolves.toMatchObject({
      state: "unavailable",
      reason: expect.stringContaining("unsupported structured output"),
    });
  });

  it("uses one bounded retry for rate limits and provider failures", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(geminiResponse('{"additional_terms":[]}'));
    const adapter = new GeminiDiscoveryAdapter({
      enabled: true,
      apiKey: "test-key",
      fetcher,
    });

    await expect(adapter.enhance(input)).resolves.toMatchObject({ state: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back after a bounded network retry", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError("simulated network failure");
    });
    const adapter = new GeminiDiscoveryAdapter({
      enabled: true,
      apiKey: "test-key",
      fetcher,
    });
    await expect(adapter.enhance(input)).resolves.toMatchObject({
      state: "unavailable",
      reason: expect.stringContaining("could not be reached"),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports configured-without-key as unavailable without making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new GeminiDiscoveryAdapter({ enabled: true, apiKey: "", fetcher });
    expect(adapter.state).toBe("unavailable");
    await expect(adapter.enhance(input)).resolves.toMatchObject({
      state: "unavailable",
      reason: expect.stringContaining("GEMINI_API_KEY"),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

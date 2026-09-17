export type AiProviderState = "disabled" | "ready" | "unavailable";

export type AiProviderResult<Output> =
  | { state: "ready"; output: Output; modelOrConfig: string }
  | { state: "disabled" | "unavailable"; reason: string };

export interface OptionalAiProvider<Input, Output> {
  readonly state: AiProviderState;
  enhance(input: Input): Promise<AiProviderResult<Output>>;
}

export class DisabledAiProvider<Input, Output>
  implements OptionalAiProvider<Input, Output>
{
  readonly state = "disabled" as const;

  async enhance(_input: Input): Promise<AiProviderResult<Output>> {
    return {
      state: "disabled",
      reason: "Optional AI is disabled; use the deterministic baseline.",
    };
  }
}


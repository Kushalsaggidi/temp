export interface ExecutorContext {
  executionId: string;
  assetVersionId: string;
  purpose: "user_run" | "prepublication_test";
}

export interface AllowlistedExecutor<Input = unknown, Output = unknown> {
  readonly key: string;
  readonly implementationVersion: string;
  readonly definitionDigest: string;
  execute(input: Input, context: ExecutorContext): Promise<Output>;
}

export interface ExecutorLookup {
  find(key: string): AllowlistedExecutor | undefined;
  keys(): readonly string[];
}


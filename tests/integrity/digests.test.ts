import { describe, expect, it } from "vitest";

import type { ExecutorManifest, JSONValue } from "@/contracts";
import {
  canonicalJson,
  computeDefinitionDigest,
  sha256Digest,
} from "@/shared/integrity";

describe("canonical integrity helpers", () => {
  it("orders object keys recursively without changing array order", () => {
    const left: JSONValue = { z: 1, nested: { b: true, a: null }, list: [2, 1] };
    const right: JSONValue = { list: [2, 1], nested: { a: null, b: true }, z: 1 };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(sha256Digest(left)).toBe(sha256Digest(right));
  });

  it("changes the definition digest when a behavior-affecting manifest field changes", () => {
    const manifest: ExecutorManifest = {
      schema_version: "1.0.0",
      executor_key: "property_ops.brief",
      implementation_version: "1.0.0",
      implementation_digest:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      input_schema_digest:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      output_schema_digest:
        "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      behavior_config_digest: null,
    };

    const original = computeDefinitionDigest(manifest);
    const changed = computeDefinitionDigest({
      ...manifest,
      implementation_version: "1.0.1",
    });

    expect(original).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(changed).not.toBe(original);
  });
});


import { describe, expect, it } from "vitest";

import {
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  loadPropertyOperationsBriefImplementationSources,
  serverExecutorRegistry,
} from "@/modules/execution";
import {
  containsPotentialSecret,
  evaluateHighImpactPolicy,
} from "@/modules/execution/policy";

describe("reviewed executor technical security boundary", () => {
  it("contains no dynamic code, process, filesystem, or network primitive", () => {
    const sources = loadPropertyOperationsBriefImplementationSources();
    expect(sources.map((source) => source.path)).toEqual([
      "artifacts.ts",
      "executor.ts",
      "registration.ts",
    ]);
    const source = sources
      .map((file) => new TextDecoder().decode(file.bytes))
      .join("\n");
    const forbidden = [
      /\beval\s*\(/,
      /\bnew\s+Function\b/,
      /\bimport\s*\(/,
      /\brequire\s*\(/,
      /node:(?:child_process|cluster|worker_threads|vm)/,
      /node:(?:fs|http|https|net|tls|dgram|dns)/,
      /\bprocess\.(?:env|exit|kill)\b/,
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\b(?:exec|execFile|fork|spawn)\s*\(/,
    ];
    for (const pattern of forbidden) expect(source).not.toMatch(pattern);
  });

  it("registers exactly one executor with an empty integration and side-effect boundary", () => {
    expect(serverExecutorRegistry.keys()).toEqual([
      PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
    ]);
    const executor = serverExecutorRegistry.resolveVerified(
      PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
    );
    expect(executor?.policy).toEqual({
      networkAccess: "none",
      filesystemAccess: "none",
      outboundIntegrations: [],
      productionSideEffects: false,
    });
    expect(serverExecutorRegistry.resolveVerified("request.module")).toBeUndefined();
  });

  it("detects common secret forms before validated-input persistence", () => {
    expect(containsPotentialSecret({ password: "ordinary-looking-value" })).toBe(true);
    expect(containsPotentialSecret({ note: `Bearer ${"a".repeat(32)}` })).toBe(true);
    expect(
      containsPotentialSecret({ note: "-----BEGIN PRIVATE KEY-----" }),
    ).toBe(true);
    expect(
      containsPotentialSecret({ note: `github_pat_${"a".repeat(24)}` }),
    ).toBe(true);
    expect(
      containsPotentialSecret({ note: `AKIA${"A".repeat(16)}` }),
    ).toBe(true);
    expect(
      containsPotentialSecret({ note: "eyJabcdefgh.ijklmnop.qrstuvwx" }),
    ).toBe(true);
    expect(containsPotentialSecret({ observation: "Synthetic safe input." })).toBe(false);
  });

  it("blocks representative housing, employment, financial, and production actions", () => {
    for (const text of [
      "Rank residents for eviction.",
      "Terminate an employee.",
      "Authorize a payment.",
      "Dispatch a work order.",
      "Update a production record.",
    ]) {
      expect(evaluateHighImpactPolicy({ instruction: text })).toMatchObject({
        allowed: false,
        code: "high_impact_action_blocked",
      });
    }
  });
});

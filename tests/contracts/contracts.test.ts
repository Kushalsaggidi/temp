import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AssetVersionSchema,
  AssetVersionRecordSchema,
  CatalogListResponseSchema,
  DigestSchema,
  DiscoveryRequestSchema,
  DiscoveryResponseSchema,
  EvidenceSchema,
  ExecutionRecordSchema,
  ExecutionRequestSchema,
  ExecutorManifestSchema,
  JSON_SCHEMA_DRAFT_2020_12,
  LifecycleEventSchema,
  JsonSchemaDocumentSchema,
} from "@/contracts";

const readFixture = (relativePath: string): unknown =>
  JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8"));

describe("canonical contract fixtures", () => {
  it("validates the bootstrap catalog record and its two reuse scenarios", () => {
    const record = AssetVersionRecordSchema.parse(
      readFixture("fixtures/catalog/bootstrap-draft.json"),
    );

    expect(record.asset.asset_id).toBe("asset_property_ops_brief");
    expect(record.asset_version.asset_version_id).toBe(
      "av_property_ops_brief_0_1_0_draft_1",
    );
    expect(record.asset_version.test_scenarios).toHaveLength(2);
    expect(record.asset_version.lifecycle).toBe("draft");
    expect(record.asset_version.availability).toBe("reference_only");
    expect(record.asset_version.subject_digest).toBeNull();
    expect(record.asset.current_published_version_id).toBeNull();
  });

  it.each([
    ["discovery request", DiscoveryRequestSchema, "fixtures/contracts/discovery-request.json"],
    ["discovery response", DiscoveryResponseSchema, "fixtures/contracts/discovery-response-matches.json"],
    ["execution request", ExecutionRequestSchema, "fixtures/contracts/execution-request.json"],
    ["execution record", ExecutionRecordSchema, "fixtures/contracts/execution-record.json"],
    ["executor manifest", ExecutorManifestSchema, "fixtures/contracts/executor-manifest.example.json"],
    ["evidence", EvidenceSchema, "fixtures/contracts/evidence.json"],
    ["lifecycle event", LifecycleEventSchema, "fixtures/contracts/lifecycle-event.json"],
    ["empty public catalog", CatalogListResponseSchema, "fixtures/contracts/catalog-list-empty.json"],
  ])("validates the %s example", (_name, schema, path) => {
    expect(() => schema.parse(readFixture(path))).not.toThrow();
  });
});

describe("cross-contract rules", () => {
  it("rejects an input schema that does not declare Draft 2020-12", () => {
    const fixture = readFixture(
      "fixtures/catalog/bootstrap-draft.json",
    ) as Record<string, any>;
    fixture.asset_version.input_schema.$schema = "http://json-schema.org/draft-07/schema#";

    const parsed = AssetVersionRecordSchema.safeParse(fixture);
    expect(parsed.success).toBe(false);
    expect(
      JsonSchemaDocumentSchema.safeParse(fixture.asset_version.input_schema)
        .success,
    ).toBe(false);
    expect(JSON_SCHEMA_DRAFT_2020_12).toContain("2020-12");
  });

  it("requires a structural root assertion in every JSON Schema document", () => {
    expect(
      JsonSchemaDocumentSchema.safeParse({
        $schema: JSON_SCHEMA_DRAFT_2020_12,
        title: "No root assertion",
      }).success,
    ).toBe(false);
    expect(
      JsonSchemaDocumentSchema.safeParse({
        $schema: JSON_SCHEMA_DRAFT_2020_12,
        type: "object",
      }).success,
    ).toBe(true);
  });

  it("rejects publication while any permission remains unconfirmed", () => {
    const fixture = readFixture(
      "fixtures/catalog/bootstrap-draft.json",
    ) as Record<string, any>;
    const version = fixture.asset_version;
    version.lifecycle = "published";
    version.subject_digest = `sha256:${"a".repeat(64)}`;
    version.published_at = "2026-09-16T10:00:00Z";

    expect(AssetVersionSchema.safeParse(version).success).toBe(false);
  });

  it("pins runnable and publication eligibility branches", () => {
    const fixture = readFixture(
      "fixtures/catalog/bootstrap-draft.json",
    ) as Record<string, any>;
    const version = fixture.asset_version;
    version.availability = "runnable";
    version.execution_kind = "deterministic";
    version.executor_key = "property.brief";
    version.definition_digest = `sha256:${"1".repeat(64)}`;
    expect(AssetVersionSchema.safeParse(version).success).toBe(true);

    delete version.executor_key;
    expect(AssetVersionSchema.safeParse(version).success).toBe(false);

    version.availability = "reference_only";
    version.execution_kind = "none";
    delete version.definition_digest;
    version.lifecycle = "published";
    version.subject_digest = `sha256:${"2".repeat(64)}`;
    version.published_at = "2026-09-16T10:00:00Z";
    version.access_permission = "confirmed";
    version.tool_use_permission = "confirmed";
    version.final_package_permission = "confirmed";
    expect(AssetVersionSchema.safeParse(version).success).toBe(true);
  });

  it("accepts every discovery outcome and enforces fallback pairing", () => {
    const matches = readFixture(
      "fixtures/contracts/discovery-response-matches.json",
    ) as Record<string, any>;
    expect(DiscoveryResponseSchema.safeParse(matches).success).toBe(true);

    const responseFor = (status: string): Record<string, any> => {
      const response = structuredClone(matches);
      response.status = status;
      response.candidates = [];
      if (status === "clarification_required") {
        response.clarification_question = "Which operating domain is in scope?";
      } else if (status === "no_match") {
        response.no_match_reason = "No published asset covers the requested task.";
      } else if (status === "guardrail") {
        response.guardrail = {
          triggered: true,
          reason: "The request asks for a high-impact decision.",
          human_review_point: "A qualified person must make the decision.",
        };
      }
      return response;
    };

    for (const status of [
      "clarification_required",
      "no_match",
      "guardrail",
    ]) {
      expect(DiscoveryResponseSchema.safeParse(responseFor(status)).success).toBe(
        true,
      );
    }

    const missingFallbackReason = structuredClone(matches);
    missingFallbackReason.fallback_used = true;
    expect(
      DiscoveryResponseSchema.safeParse(missingFallbackReason).success,
    ).toBe(false);
    missingFallbackReason.fallback_reason = "Optional AI was unavailable.";
    expect(
      DiscoveryResponseSchema.safeParse(missingFallbackReason).success,
    ).toBe(true);
  });

  it("pins execution terminal branches", () => {
    const succeeded = readFixture(
      "fixtures/contracts/execution-record.json",
    ) as Record<string, any>;

    const failed = structuredClone(succeeded);
    failed.status = "failed";
    delete failed.output;
    failed.error = {
      code: "fixture_failure",
      message: "Synthetic failure for branch validation.",
      retryable: false,
    };

    const invalid = structuredClone(succeeded);
    invalid.status = "invalid";
    delete invalid.executor_key;
    delete invalid.definition_digest;
    delete invalid.validated_input;
    delete invalid.output;
    invalid.rejection_reason = "Synthetic input did not satisfy the contract.";

    const pending = structuredClone(succeeded);
    pending.status = "pending";
    pending.completed_at = null;
    delete pending.output;

    for (const record of [succeeded, failed, invalid, pending]) {
      expect(ExecutionRecordSchema.safeParse(record).success).toBe(true);
    }

    const incompleteFailure = structuredClone(failed);
    delete incompleteFailure.error;
    expect(ExecutionRecordSchema.safeParse(incompleteFailure).success).toBe(false);
  });

  it("rejects unknown request fields and malformed digests", () => {
    expect(
      DiscoveryRequestSchema.safeParse({ query: "find a brief", extra: true })
        .success,
    ).toBe(false);
    expect(DigestSchema.safeParse(`sha256:${"A".repeat(64)}`).success).toBe(
      false,
    );
    expect(DigestSchema.safeParse(`sha256:${"a".repeat(64)}`).success).toBe(true);
  });

  it("rejects the draft bootstrap record from the public catalog contract", () => {
    const draft = readFixture("fixtures/catalog/bootstrap-draft.json");
    expect(
      CatalogListResponseSchema.safeParse({ items: [draft], count: 1 }).success,
    ).toBe(false);
  });

  it("rejects a succeeded execution without resolved provenance", () => {
    const execution = readFixture(
      "fixtures/contracts/execution-record.json",
    ) as Record<string, unknown>;
    delete execution.definition_digest;

    expect(ExecutionRecordSchema.safeParse(execution).success).toBe(false);
  });

  it("rejects system-created human-review evidence", () => {
    const evidence = readFixture(
      "fixtures/contracts/evidence.json",
    ) as Record<string, unknown>;
    evidence.evidence_type = "human_review";
    evidence.actor_type = "system";

    expect(EvidenceSchema.safeParse(evidence).success).toBe(false);
  });
});

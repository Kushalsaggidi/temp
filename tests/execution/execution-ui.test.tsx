import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TryAssetPage from "@/app/assets/[assetVersionId]/try/page";
import {
  ExecutionOutcome,
  TryResultProvenance,
  buildHeroExecutionRequest,
  type HeroExecutionFormValue,
} from "@/components/execution/try-result-provenance";
import { ReuseEvidenceComparison } from "@/components/execution/reuse-evidence-comparison";
import {
  AssetVersionRecordSchema,
  ExecutionRecordSchema,
  type AssetVersionRecord,
  type ExecutionRecord,
} from "@/contracts";
import type { ReuseComparison } from "@/modules/execution/reuse-comparison";
import bootstrapDraft from "../../fixtures/catalog/bootstrap-draft.json";

const catalogState = vi.hoisted(() => ({
  record: null as AssetVersionRecord | null,
}));
const reuseState = vi.hoisted(() => ({
  comparison: {
    available: false,
    reason: "invalid_reuse_evidence",
  } as ReuseComparison,
  selectedVersionId: null as string | null,
}));

vi.mock("@/modules/catalog", () => ({
  withCatalogService: async (
    operation: (service: {
      getAdminVersionById: (assetVersionId: string) => AssetVersionRecord | null;
    }) => unknown,
  ) =>
    operation({
      getAdminVersionById: () => catalogState.record,
    }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/modules/execution/reuse-runtime", () => ({
  loadPersistedReuseComparison: (version: { asset_version_id: string }) => {
    reuseState.selectedVersionId = version.asset_version_id;
    return reuseState.comparison;
  },
}));

const digest = `sha256:${"a".repeat(64)}`;

const availableReuseComparison: ReuseComparison = {
  available: true,
  evidence_id: "evidence_property_ops_reuse",
  subject_digest: `sha256:${"b".repeat(64)}`,
  shared: {
    asset_id: "asset_property_ops_brief",
    asset_version_id: "av_property_ops_brief_1_0_0",
    asset_version: "1.0.0",
    executor_key: "property_ops.brief",
    definition_digest: digest,
    configuration_digest: digest,
    execution_purpose: "prepublication_test",
  },
  scenarios: [
    {
      execution_id: "execution_reuse_scenario_a",
      scenario_label: "Synthetic maintenance backlog review",
      status: "succeeded",
      started_at: "2026-09-16T10:00:00Z",
      completed_at: "2026-09-16T10:00:01Z",
    },
    {
      execution_id: "execution_reuse_scenario_b",
      scenario_label: "Synthetic energy variance review",
      status: "succeeded",
      started_at: "2026-09-16T10:01:00Z",
      completed_at: "2026-09-16T10:01:01Z",
    },
  ],
  core_implementation_unchanged: true,
  statement:
    "Core implementation unchanged: both persisted runs use the same executor key and definition digest.",
};

function publishedRunnableRecord(): AssetVersionRecord {
  const value = structuredClone(bootstrapDraft) as Record<string, any>;
  value.asset.current_published_version_id =
    value.asset_version.asset_version_id;
  Object.assign(value.asset_version, {
    execution_kind: "deterministic",
    availability: "runnable",
    executor_key: "property_ops.brief",
    definition_digest: digest,
    lifecycle: "published",
    subject_digest: `sha256:${"b".repeat(64)}`,
    published_at: "2026-09-16T10:00:00Z",
    access_permission: "confirmed",
    tool_use_permission: "confirmed",
    final_package_permission: "confirmed",
  });
  return AssetVersionRecordSchema.parse(value);
}

function recordFor(
  status: ExecutionRecord["status"],
  changes: Record<string, unknown> = {},
): ExecutionRecord {
  const base: Record<string, unknown> = {
    execution_id: `execution_ui_${status}`,
    asset_id: "asset_property_ops_brief",
    asset_version_id: "av_property_ops_brief_1_0_0",
    asset_version: "1.0.0",
    executor_key: "property_ops.brief",
    definition_digest: digest,
    purpose: "user_run",
    status,
    validated_input: {
      brief_title: "Weekly review",
      audience: "Regional reviewer",
      observations: ["Synthetic observation"],
    },
    validation_results: [],
    execution_mode: "deterministic",
    model_or_config: {
      provider: "local",
      configuration_digest: digest,
      parameters: {
        secret: "never-render-config-secret",
      },
    },
    started_at: "2026-09-16T10:00:00Z",
    completed_at: ["pending", "running"].includes(status)
      ? null
      : "2026-09-16T10:00:01Z",
  };

  if (status === "succeeded") {
    base.output = {
      title: "Weekly review",
      summary: ["Synthetic observation"],
      review_questions: ["Has a human verified this observation?"],
      limitations: ["Synthetic inputs only"],
    };
    base.validation_results = [
      {
        stage: "output",
        valid: true,
        code: "schema_valid",
        message: "Output matched the schema.",
      },
    ];
  }

  if (status === "failed") {
    base.error = {
      code: "executor_failed",
      message: "The executor stopped safely.",
      retryable: false,
      details: { secret: "never-render-error-secret" },
    };
  }

  if (status === "invalid" || status === "blocked") {
    delete base.executor_key;
    delete base.definition_digest;
    delete base.validated_input;
    base.rejection_reason =
      status === "invalid"
        ? "The input did not match the canonical schema."
        : "The selected version is not eligible for execution.";
  }

  Object.assign(base, changes);

  return ExecutionRecordSchema.parse(base);
}

describe("execution try, result, and provenance UI", () => {
  it("renders the structured hero form without exposing executor selection", () => {
    const markup = renderToStaticMarkup(
      createElement(TryResultProvenance, {
        assetName: "Property Operations Brief Builder",
        assetVersionId: "av_property_ops_brief_1_0_0",
      }),
    );

    expect(markup).toContain('name="brief_title"');
    expect(markup).toContain('name="audience"');
    expect(markup).toContain('name="observations"');
    expect(markup).toContain('name="constraints"');
    expect(markup).toContain("Create the brief");
    expect(markup).not.toContain('name="executor_key"');
    expect(markup).not.toContain('name="purpose"');
    expect(markup).not.toContain('name="definition_digest"');
  });

  it("builds only the canonical request fields and converts newline lists", () => {
    const value: HeroExecutionFormValue = {
      briefTitle: " Weekly review ",
      audience: " Regional reviewer ",
      observations: "First observation\n\n Second observation ",
      constraints: "Do not infer causes.\nHuman verification required.",
    };

    expect(
      buildHeroExecutionRequest("av_property_ops_brief_1_0_0", value),
    ).toEqual({
      asset_version_id: "av_property_ops_brief_1_0_0",
      input: {
        brief_title: "Weekly review",
        audience: "Regional reviewer",
        observations: ["First observation", "Second observation"],
        constraints: [
          "Do not infer causes.",
          "Human verification required.",
        ],
      },
    });
  });

  it.each([
    ["pending", "Execution accepted"],
    ["running", "Execution in progress"],
    ["invalid", "Input rejected before execution"],
    ["blocked", "Execution blocked"],
    ["failed", "Execution failed"],
  ] as const)("renders the %s outcome honestly", (status, expected) => {
    const markup = renderToStaticMarkup(
      createElement(ExecutionOutcome, { record: recordFor(status) }),
    );

    expect(markup).toContain(expected);
    expect(markup).toContain(`execution_ui_${status}`);
    expect(markup).not.toContain("Synthetic observation</li>");
  });

  it("renders schema-known successful output and allowlisted provenance", () => {
    const markup = renderToStaticMarkup(
      createElement(ExecutionOutcome, { record: recordFor("succeeded") }),
    );

    expect(markup).toContain("Execution succeeded");
    expect(markup).toContain("Weekly review");
    expect(markup).toContain("Review questions");
    expect(markup).toContain("execution_ui_succeeded");
    expect(markup).toContain("property_ops.brief");
    expect(markup).toContain(digest);
    expect(markup).toContain("Configuration digest");
    expect(markup).not.toContain("never-render-config-secret");
  });

  it("escapes hostile output text and never uses raw HTML rendering", () => {
    const hostile = recordFor("succeeded", {
      output: {
        title: "<script>alert('title')</script>",
        summary: ['<img src=x onerror="alert(1)">'],
        review_questions: ["<script>alert('question')</script>"],
        limitations: ["<b>not markup</b>"],
      },
    });
    const markup = renderToStaticMarkup(
      createElement(ExecutionOutcome, { record: hostile }),
    );
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/execution/try-result-provenance.tsx",
      ),
      "utf8",
    );

    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&lt;img");
    expect(markup).toContain("&lt;b&gt;not markup&lt;/b&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img src=x");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  it("does not expose persisted error details or configuration parameters", () => {
    const markup = renderToStaticMarkup(
      createElement(ExecutionOutcome, { record: recordFor("failed") }),
    );

    expect(markup).toContain("The executor stopped safely.");
    expect(markup).toContain("executor_failed");
    expect(markup).not.toContain("never-render-error-secret");
    expect(markup).not.toContain("never-render-config-secret");
    expect(markup).not.toContain("validated_input");
  });

  it("refuses to display successful output with unknown fields", () => {
    const record = recordFor("succeeded", {
      output: {
        title: "Safe title",
        summary: ["Safe summary"],
        review_questions: ["Safe question"],
        unexpected_html: "<script>not rendered</script>",
      },
    });
    const markup = renderToStaticMarkup(
      createElement(ExecutionOutcome, { record }),
    );

    expect(markup).toContain("not in a shape we can safely display");
    expect(markup).not.toContain("not rendered");
  });
});

describe("public try page eligibility", () => {
  beforeEach(() => {
    reuseState.comparison = {
      available: false,
      reason: "invalid_reuse_evidence",
    };
    reuseState.selectedVersionId = null;
  });

  it("renders only a current published runnable version with executor metadata", async () => {
    catalogState.record = publishedRunnableRecord();

    const page = await TryAssetPage({
      params: Promise.resolve({
        assetVersionId: catalogState.record.asset_version.asset_version_id,
      }),
    });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Try Property Operations Brief Builder");
    expect(markup).toContain("Create the brief");
    expect(markup).toContain("every run is saved");
    expect(markup).toContain("No reuse proof yet");
    expect(reuseState.selectedVersionId).toBe(
      catalogState.record.asset_version.asset_version_id,
    );
  });

  it("shows the persisted reviewer-visible comparison when proof is available", async () => {
    catalogState.record = publishedRunnableRecord();
    reuseState.comparison = {
      ...availableReuseComparison,
      shared: {
        ...availableReuseComparison.shared,
        asset_version_id:
          catalogState.record.asset_version.asset_version_id,
        asset_version: catalogState.record.asset_version.version,
      },
    };

    const page = await TryAssetPage({
      params: Promise.resolve({
        assetVersionId: catalogState.record.asset_version.asset_version_id,
      }),
    });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Reuse proof");
    // Scenarios are numbered rather than lettered in the reader-facing view.
    expect(markup).toContain("Same asset, two different jobs");
    expect(markup).toMatch(/maintenance backlog review[\s\S]*energy variance review/i);
    expect(markup).toContain("execution_reuse_scenario_a");
    expect(markup).toContain("execution_reuse_scenario_b");
    expect(markup).toContain(
      "Core implementation unchanged: both persisted runs use the same executor key and definition digest.",
    );
  });

  it.each([
    "unpublished",
    "nonrunnable",
    "noncurrent",
    "deprecated",
  ] as const)("returns not found for a %s version", async (condition) => {
    const value = structuredClone(publishedRunnableRecord()) as Record<
      string,
      any
    >;

    if (condition === "unpublished") {
      value.asset.current_published_version_id = null;
      value.asset_version.lifecycle = "draft";
      value.asset_version.published_at = null;
    } else if (condition === "nonrunnable") {
      value.asset_version.availability = "reference_only";
      value.asset_version.execution_kind = "none";
      delete value.asset_version.executor_key;
      delete value.asset_version.definition_digest;
    } else if (condition === "noncurrent") {
      value.asset.current_published_version_id = null;
    } else {
      value.asset.current_published_version_id = null;
      value.asset_version.lifecycle = "deprecated";
      value.asset_version.deprecated_at = "2026-09-16T11:00:00Z";
    }

    catalogState.record = AssetVersionRecordSchema.parse(value);

    await expect(
      TryAssetPage({
        params: Promise.resolve({
          assetVersionId: catalogState.record.asset_version.asset_version_id,
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("reviewer-visible reuse evidence comparison", () => {
  it("renders distinct Scenario A/B records and their shared provenance", () => {
    const markup = renderToStaticMarkup(
      createElement(ReuseEvidenceComparison, {
        comparison: availableReuseComparison,
      }),
    );

    // Scenarios are numbered rather than lettered in the reader-facing view.
    expect(markup).toContain("Same asset, two different jobs");
    expect(markup).toMatch(/maintenance backlog review[\s\S]*energy variance review/i);
    expect(markup).toContain("Synthetic maintenance backlog review");
    expect(markup).toContain("Synthetic energy variance review");
    expect(markup).toContain("execution_reuse_scenario_a");
    expect(markup).toContain("execution_reuse_scenario_b");
    expect(markup).toContain("asset_property_ops_brief");
    expect(markup).toContain("av_property_ops_brief_1_0_0");
    expect(markup).toContain("property_ops.brief");
    expect(markup).toContain(digest);
    expect(markup).toContain("Configuration digest");
    expect(markup).toContain(
      "Core implementation unchanged: both persisted runs use the same executor key and definition digest.",
    );
  });

  it("renders an unavailable state without a partial proof claim", () => {
    const comparison: ReuseComparison = {
      available: false,
      reason: "execution_provenance_mismatch",
    };
    const markup = renderToStaticMarkup(
      createElement(ReuseEvidenceComparison, { comparison }),
    );

    expect(markup).toContain("No reuse proof yet");
    expect(markup).toContain("execution_provenance_mismatch");
    expect(markup).toContain(
      "The persisted runs do not share the required execution provenance.",
    );
    expect(markup).not.toContain("Core implementation unchanged");
    expect(markup).not.toContain("Scenario A");
  });

  it.each([
    [
      "execution_scenario_mismatch",
      "The persisted runs are not bound to the two exact frozen scenario fixtures.",
    ],
    [
      "execution_configuration_mismatch",
      "The persisted runs do not share the same recorded reviewed configuration.",
    ],
    [
      "execution_functional_assertions_incomplete",
      "The persisted runs did not pass the required usefulness and safety assertions.",
    ],
  ] as const)("renders the %s unavailable explanation", (reason, message) => {
    const markup = renderToStaticMarkup(
      createElement(ReuseEvidenceComparison, {
        comparison: { available: false, reason },
      }),
    );

    expect(markup).toContain(message);
    expect(markup).not.toContain("Core implementation unchanged");
  });

  it("escapes scenario text and the evidence statement", () => {
    const comparison: ReuseComparison = {
      ...availableReuseComparison,
      scenarios: [
        {
          ...availableReuseComparison.scenarios[0],
          scenario_label: "<script>alert('scenario')</script>",
        },
        availableReuseComparison.scenarios[1],
      ],
      statement: "<b>Core implementation unchanged</b>",
    };
    const markup = renderToStaticMarkup(
      createElement(ReuseEvidenceComparison, { comparison }),
    );
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/execution/reuse-evidence-comparison.tsx",
      ),
      "utf8",
    );

    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&lt;b&gt;Core implementation unchanged&lt;/b&gt;");
    expect(markup).not.toContain("<script>");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});

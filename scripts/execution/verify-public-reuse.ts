import {
  ExecutionRecordSchema,
  type AssetVersionRecord,
} from "../../src/contracts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { CatalogRepository } from "../../src/modules/catalog/repository";
import {
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_MANIFEST,
  evaluateScenarioExecution,
} from "../../src/modules/execution";
import { closeDatabase, openDatabase } from "../../src/server/db/connection";
import { migrateDatabase } from "../../src/server/db/migrate";

const ASSET_VERSION_ID = "av_property_ops_brief_0_1_0_draft_1";
export const PUBLIC_REUSE_FETCH_TIMEOUT_MS = 10_000;

export async function withPublicFetchDeadline<T>(
  activity: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PUBLIC_REUSE_FETCH_TIMEOUT_MS);

  try {
    return await operation(controller.signal);
  } catch (cause) {
    if (timedOut) {
      throw new Error(`Public verification timed out while ${activity}.`);
    }
    throw cause;
  } finally {
    clearTimeout(deadline);
  }
}

function requireLoopbackBaseUrl(): URL {
  const url = new URL(
    process.env.MARKETPLACE_BASE_URL ?? "http://127.0.0.1:3000",
  );
  if (
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol)
  ) {
    throw new Error(
      "Public verification is restricted to a locally served marketplace URL.",
    );
  }
  return url;
}

export async function verifyPublicReuse(): Promise<void> {
  const database = openDatabase();
  let record: AssetVersionRecord | null;
  try {
    migrateDatabase(database);
    record = new CatalogRepository(database).getAdminVersionById(ASSET_VERSION_ID);
  } finally {
    closeDatabase(database);
  }
  if (record === null) throw new Error("The finalized hero version is unavailable.");
  const version = record.asset_version;
  if (
    version.lifecycle !== "published" ||
    version.published_at === null ||
    version.deprecated_at !== null ||
    record.asset.current_published_version_id !== version.asset_version_id ||
    version.availability !== "runnable" ||
    version.subject_digest === null ||
    version.executor_key !== PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY ||
    version.definition_digest !== PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST
  ) {
    throw new Error(
      "Postpublication verification stopped: the current published hero metadata does not match the frozen reviewed executor.",
    );
  }

  const baseUrl = requireLoopbackBaseUrl();
  const tryUrl = new URL(`/assets/${version.asset_version_id}/try`, baseUrl);
  const { response: pageResponse, body: pageHtml } =
    await withPublicFetchDeadline("loading the public Try UI", async (signal) => {
      const response = await fetch(tryUrl, {
        headers: { accept: "text/html" },
        redirect: "error",
        signal,
      });
      const body = await response.text();
      return { response, body };
    });
  if (
    !pageResponse.ok ||
    !pageHtml.includes("Run this asset") ||
    !pageHtml.includes("One frozen core, two scenarios") ||
    !pageHtml.includes("Core implementation unchanged") ||
    ![
      version.asset_id,
      version.asset_version_id,
      version.version,
      version.subject_digest,
      version.executor_key,
      version.definition_digest,
      PROPERTY_OPERATIONS_BRIEF_MANIFEST.behavior_config_digest,
    ].every((value) => value !== null && pageHtml.includes(value))
  ) {
    throw new Error(
      "The public Try UI or current-subject persisted reuse comparison is unavailable.",
    );
  }

  const runs = [];
  for (const scenario of version.test_scenarios) {
    const { response, body } = await withPublicFetchDeadline(
      "running a public scenario",
      async (signal) => {
        const response = await fetch(new URL("/api/executions", baseUrl), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          redirect: "error",
          signal,
          body: JSON.stringify({
            asset_version_id: version.asset_version_id,
            scenario_label: scenario.label,
            input: scenario.input_fixture,
          }),
        });
        const body: unknown = await response.json();
        return { response, body };
      },
    );
    if (!response.ok) {
      throw new Error(`The public API rejected ${scenario.label}.`);
    }
    const run = ExecutionRecordSchema.parse(body);
    const evaluation = evaluateScenarioExecution(
      scenario,
      run,
      version.output_schema,
    );
    if (
      run.status !== "succeeded" ||
      run.purpose !== "user_run" ||
      !evaluation.output_schema_valid ||
      !evaluation.usefulness_passed ||
      !evaluation.safety_passed
    ) {
      throw new Error(
        `The public result for ${scenario.label} failed a functional or safety assertion.`,
      );
    }
    runs.push(run);
  }

  if (
    runs.length !== 2 ||
    runs[0].execution_id === runs[1].execution_id ||
    runs[0].model_or_config === undefined ||
    runs[1].model_or_config === undefined ||
    runs[0].model_or_config.configuration_digest !==
      PROPERTY_OPERATIONS_BRIEF_MANIFEST.behavior_config_digest ||
    !isDeepStrictEqual(runs[0].model_or_config, runs[1].model_or_config) ||
    runs.some(
      (run) =>
        run.asset_id !== version.asset_id ||
        run.asset_version_id !== version.asset_version_id ||
        run.asset_version !== version.version ||
        run.executor_key !== version.executor_key ||
        run.definition_digest !== version.definition_digest,
    )
  ) {
    throw new Error("The two public runs do not prove unchanged-core reuse.");
  }

  console.log(JSON.stringify({
    verification: "postpublication-public-ui-api-reuse",
    verified_at: new Date().toISOString(),
    ui_path: tryUrl.toString(),
    execution_ids: runs.map((run) => run.execution_id),
    shared: {
      asset_id: version.asset_id,
      asset_version_id: version.asset_version_id,
      asset_version: version.version,
      subject_digest: version.subject_digest,
      executor_key: version.executor_key,
      definition_digest: version.definition_digest,
      configuration_digest:
        runs[0].model_or_config.configuration_digest,
    },
    core_implementation_unchanged: true,
  }, null, 2));
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  verifyPublicReuse().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown failure.";
    console.error(message);
    process.exitCode = 1;
  });
}

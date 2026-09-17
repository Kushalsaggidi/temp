import { z } from "zod";

import {
  contractSchemaRegistry,
  type ContractSchemaName,
} from "../../src/contracts/registry";

type JsonSchemaObject = Record<string, unknown>;

const schemaBaseUri = "https://realpage.local/ai-marketplace/contracts";

const runtimeRefinements: Partial<Record<ContractSchemaName, string[]>> = {
  asset: ["updated_at must not be earlier than created_at"],
  "asset-version": [
    "runnable requires executor_key and definition_digest, and execution_kind must not be none",
    "non-runnable forbids executor_key and definition_digest",
    "published/deprecated requires subject_digest and published_at",
    "published/deprecated forbids unconfirmed access, tool-use, or final-package permissions",
    "deprecated requires deprecated_at; only deprecated may specify replacement_version",
    "third_party requires source, license, attribution, evidence, and confirmed permissions",
  ],
  "asset-version-record": [
    "asset.asset_id must equal asset_version.asset_id",
    "current_published_version_id may point only at a published asset_version",
  ],
  "discovery-response": [
    "fallback_reason is present exactly when fallback_used is true",
  ],
  "execution-record": [
    "pending/running/succeeded/failed require executor_key, definition_digest, and validated_input",
    "terminal statuses require completed_at; pending/running forbid it",
    "succeeded requires output, failed requires error, invalid/blocked require rejection_reason",
    "succeeded requires a valid output-stage validation result",
    "completed_at must not be earlier than started_at",
  ],
  evidence: [
    "system evidence forbids actor_name; demo_reviewer evidence requires reviewer",
    "human_review requires a human actor; passed security_review requires reviewer details",
  ],
  "lifecycle-event": [
    "from_state, when present, must differ from to_state",
    "system events forbid actor_name",
  ],
  "catalog-list-response": [
    "count must equal items.length",
    "items must be current, published versions with a frozen subject_digest",
  ],
};

const titleFromName = (name: string): string =>
  name
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

export const schemaFileName = (name: ContractSchemaName): string => `${name}.schema.json`;

export const buildContractSchema = (name: ContractSchemaName): JsonSchemaObject => {
  const generated = z.toJSONSchema(contractSchemaRegistry[name], {
    target: "draft-2020-12",
    unrepresentable: "throw",
    cycles: "ref",
    reused: "ref",
  }) as JsonSchemaObject;
  const { $schema, ...body } = generated;
  const refinements = runtimeRefinements[name];

  return {
    $schema,
    $id: `${schemaBaseUri}/${schemaFileName(name)}`,
    title: titleFromName(name),
    ...body,
    ...(refinements === undefined
      ? {}
      : {
          "x-zod-runtime-refinements": refinements,
        }),
  };
};

export const serializeArtifact = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export const buildContractArtifacts = (): ReadonlyMap<string, string> => {
  const entries = Object.keys(contractSchemaRegistry) as ContractSchemaName[];
  const artifacts = new Map<string, string>();

  for (const name of entries) {
    artifacts.set(schemaFileName(name), serializeArtifact(buildContractSchema(name)));
  }

  artifacts.set(
    "manifest.json",
    serializeArtifact({
      schema_version: "1.0.0",
      target: "https://json-schema.org/draft/2020-12/schema",
      schemas: entries.map((name) => ({
        name,
        file: schemaFileName(name),
        id: `${schemaBaseUri}/${schemaFileName(name)}`,
      })),
    }),
  );

  return artifacts;
};

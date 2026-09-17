import type {
  ExecutorManifest,
  JsonSchemaDocument,
  ModelOrConfig,
} from "@/contracts";

import { propertyOperationsBriefExecutor } from "./executor";

export interface PropertyOperationsBriefRegistrationArtifacts {
  manifest: ExecutorManifest;
  definitionDigest: `sha256:${string}`;
  inputSchema: JsonSchemaDocument;
  outputSchema: JsonSchemaDocument;
}

const NO_OUTBOUND_INTEGRATIONS: readonly [] = Object.freeze([] as []);

/**
 * This is part of the reviewed implementation bundle. It binds the exact
 * executable function reference to its declared mode, configuration, and
 * denied capabilities without adding an unhashed invocation wrapper.
 */
export function createPropertyOperationsBriefRegistration({
  manifest,
  definitionDigest,
  inputSchema,
  outputSchema,
}: PropertyOperationsBriefRegistrationArtifacts) {
  const configurationDigest = manifest.behavior_config_digest;
  if (configurationDigest === null) {
    throw new Error(
      "The deterministic executor requires reviewed behavior configuration.",
    );
  }

  const modelOrConfig: ModelOrConfig = {
    provider: "local",
    configuration_digest: configurationDigest,
    parameters: {
      implementation_version: manifest.implementation_version,
      execution_mode: "deterministic",
    },
  };

  return Object.freeze({
    key: propertyOperationsBriefExecutor.key,
    implementationVersion: propertyOperationsBriefExecutor.implementationVersion,
    manifest: Object.freeze({ ...manifest }),
    definitionDigest,
    executionMode: "deterministic" as const,
    inputSchema: Object.freeze(inputSchema),
    outputSchema: Object.freeze(outputSchema),
    modelOrConfig: Object.freeze(modelOrConfig),
    policy: Object.freeze({
      networkAccess: "none" as const,
      filesystemAccess: "none" as const,
      outboundIntegrations: NO_OUTBOUND_INTEGRATIONS,
      productionSideEffects: false as const,
    }),
    execute: propertyOperationsBriefExecutor.execute,
  });
}

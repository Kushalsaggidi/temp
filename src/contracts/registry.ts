import type { z } from "zod";

import {
  AssetSchema,
  AssetVersionContentSchema,
  AssetVersionGovernanceSchema,
  AssetVersionRecordSchema,
  AssetVersionSchema,
  TestScenarioSchema,
} from "./catalog";
import {
  DiscoveryRequestSchema,
  DiscoveryResponseSchema,
} from "./discovery";
import { ExecutionRecordSchema, ExecutionRequestSchema } from "./execution";
import { ExecutorManifestSchema } from "./executor";
import { EvidenceSchema, LifecycleEventSchema } from "./governance";
import {
  AdminCatalogVersionResponseSchema,
  CatalogListResponseSchema,
} from "./responses";
import { JsonSchemaDocumentSchema } from "./primitives";

export const contractSchemaRegistry = {
  asset: AssetSchema,
  "asset-version-content": AssetVersionContentSchema,
  "asset-version-governance": AssetVersionGovernanceSchema,
  "asset-version": AssetVersionSchema,
  "asset-version-record": AssetVersionRecordSchema,
  "test-scenario": TestScenarioSchema,
  "json-schema-document": JsonSchemaDocumentSchema,
  "discovery-request": DiscoveryRequestSchema,
  "discovery-response": DiscoveryResponseSchema,
  "execution-request": ExecutionRequestSchema,
  "execution-record": ExecutionRecordSchema,
  "executor-manifest": ExecutorManifestSchema,
  evidence: EvidenceSchema,
  "lifecycle-event": LifecycleEventSchema,
  "admin-catalog-version-response": AdminCatalogVersionResponseSchema,
  "catalog-list-response": CatalogListResponseSchema,
} satisfies Record<string, z.ZodType>;

export type ContractSchemaName = keyof typeof contractSchemaRegistry;

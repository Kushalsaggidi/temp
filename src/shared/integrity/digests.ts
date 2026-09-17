import { createHash } from "node:crypto";

import {
  AssetVersionContentSchema,
  ExecutorManifestSchema,
  JSONValueSchema,
  type AssetVersionContent,
  type ExecutorManifest,
  type JSONValue,
} from "@/contracts";

import { canonicalJson } from "./canonical-json";

export const SUBJECT_DIGEST_SCHEMA_VERSION = "subject-digest-v1" as const;

export function sha256Digest(value: JSONValue): `sha256:${string}` {
  const hex = createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function computeDefinitionDigest(
  manifestValue: ExecutorManifest,
): `sha256:${string}` {
  const manifest = ExecutorManifestSchema.parse(manifestValue);
  return sha256Digest(JSONValueSchema.parse(manifest));
}

/**
 * The subject binds every immutable version-content field and the separately
 * named executor definition digest. Governance projection fields and the digest
 * itself are deliberately outside this manifest.
 */
export function computeSubjectDigest(
  contentValue: AssetVersionContent,
): `sha256:${string}` {
  const content = AssetVersionContentSchema.parse(contentValue);
  const { definition_digest, ...versionContentWithoutDefinitionDigest } = content;

  return sha256Digest(JSONValueSchema.parse({
    schema_version: SUBJECT_DIGEST_SCHEMA_VERSION,
    version_content: versionContentWithoutDefinitionDigest,
    definition_digest: definition_digest ?? null,
  }));
}

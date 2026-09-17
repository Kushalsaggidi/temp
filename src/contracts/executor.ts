import { z } from "zod";

import { DigestSchema, ExecutorKeySchema, SemVerSchema } from "./primitives";

/**
 * Identity handoff from an executor owner to the catalog owner. Digests identify
 * reviewed artifacts; this manifest does not itself make an executor runnable.
 */
export const ExecutorManifestSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    executor_key: ExecutorKeySchema,
    implementation_version: SemVerSchema,
    implementation_digest: DigestSchema,
    input_schema_digest: DigestSchema,
    output_schema_digest: DigestSchema,
    behavior_config_digest: DigestSchema.nullable(),
  })
  .strict();

export type ExecutorManifest = z.infer<typeof ExecutorManifestSchema>;

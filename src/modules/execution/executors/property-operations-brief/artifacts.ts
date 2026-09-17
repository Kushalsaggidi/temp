import { z } from "zod";

import {
  ExecutorManifestSchema,
  JsonSchemaDocumentSchema,
  type ExecutorManifest,
  type JsonSchemaDocument,
} from "@/contracts";
import { computeDefinitionDigest } from "@/shared/integrity";

import behaviorConfigDocument from "./behavior-config.json";
import inputSchemaDocument from "./input.schema.json";
import manifestDocument from "./manifest.json";
import outputSchemaDocument from "./output.schema.json";

export const PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY =
  "property_ops.brief_builder" as const;
export const PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION = "1.0.0" as const;

export const PropertyOperationsBriefBehaviorConfigSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    human_verification_question_template: z
      .string()
      .min(1)
      .refine((value) => value.includes("{audience}"), {
        message: "The human-verification template must contain {audience}",
      }),
    observation_review_question_template: z
      .string()
      .min(1)
      .refine((value) => value.includes("{observation}"), {
        message: "The observation template must contain {observation}",
      }),
    constraint_review_question_template: z
      .string()
      .min(1)
      .refine((value) => value.includes("{constraint}"), {
        message: "The constraint template must contain {constraint}",
      }),
    limitations: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export type PropertyOperationsBriefBehaviorConfig = z.infer<
  typeof PropertyOperationsBriefBehaviorConfigSchema
>;

export type ReadonlyPropertyOperationsBriefBehaviorConfig = Readonly<
  Omit<PropertyOperationsBriefBehaviorConfig, "limitations">
> & {
  readonly limitations: readonly string[];
};

const parsedManifest = ExecutorManifestSchema.parse(manifestDocument);
if (parsedManifest.executor_key !== PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY) {
  throw new Error("The reviewed executor manifest has an unexpected executor key.");
}
if (
  parsedManifest.implementation_version !==
  PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION
) {
  throw new Error(
    "The reviewed executor manifest has an unexpected implementation version.",
  );
}

export const PROPERTY_OPERATIONS_BRIEF_MANIFEST: Readonly<ExecutorManifest> =
  Object.freeze(parsedManifest);

export const PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST =
  computeDefinitionDigest(PROPERTY_OPERATIONS_BRIEF_MANIFEST);

export const PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA: Readonly<JsonSchemaDocument> =
  Object.freeze(JsonSchemaDocumentSchema.parse(inputSchemaDocument));

export const PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA: Readonly<JsonSchemaDocument> =
  Object.freeze(JsonSchemaDocumentSchema.parse(outputSchemaDocument));

const parsedBehaviorConfig = PropertyOperationsBriefBehaviorConfigSchema.parse(
  behaviorConfigDocument,
);

export const PROPERTY_OPERATIONS_BRIEF_BEHAVIOR_CONFIG: ReadonlyPropertyOperationsBriefBehaviorConfig =
  Object.freeze({
    ...parsedBehaviorConfig,
    limitations: Object.freeze([...parsedBehaviorConfig.limitations]),
  });

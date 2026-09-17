import { z } from "zod";

const opaqueId = (prefix: string) =>
  z
    .string()
    .regex(
      new RegExp(`^${prefix}_[a-z0-9]+(?:_[a-z0-9]+)*$`),
      `Expected an opaque ${prefix}_ identifier`,
    );

export const AssetIdSchema = opaqueId("asset").describe("Stable asset identifier");
export const AssetVersionIdSchema = opaqueId("av").describe(
  "Immutable asset-version identifier",
);
export const QueryIdSchema = opaqueId("query").describe("Discovery query identifier");
export const ExecutionIdSchema = opaqueId("execution").describe("Execution identifier");
export const EvidenceIdSchema = opaqueId("evidence").describe("Evidence identifier");
export const LifecycleEventIdSchema = opaqueId("event").describe(
  "Lifecycle event identifier",
);
export const ScenarioIdSchema = opaqueId("scenario").describe("Test scenario identifier");

export const UtcTimestampSchema = z
  .iso.datetime({ offset: false })
  .describe("ISO 8601 UTC timestamp ending in Z");

// SemVer 2.0.0, including pre-release and build metadata identifiers.
export const SemVerSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
    "Expected a SemVer 2.0.0 version",
  );

export const DigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 lowercase hex characters>");

export const ExecutorKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, "Expected a namespaced executor key");

export const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a lowercase kebab-case slug");

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };

export const JSONValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JSONValueSchema),
    z.record(z.string(), JSONValueSchema),
  ]),
);

export const JSONObjectSchema: z.ZodType<JSONObject> = z.record(
  z.string(),
  JSONValueSchema,
);

export const JSON_SCHEMA_DRAFT_2020_12 =
  "https://json-schema.org/draft/2020-12/schema" as const;

const JsonSchemaTypeNameSchema = z.enum([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "string",
  "integer",
]);
const jsonSchemaDialectShape = {
  $schema: z.literal(JSON_SCHEMA_DRAFT_2020_12),
};
const jsonSchemaDocument = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({ ...jsonSchemaDialectShape, ...shape }).catchall(JSONValueSchema);

export const JsonSchemaDocumentSchema = z.union([
  jsonSchemaDocument({
    type: z.union([
      JsonSchemaTypeNameSchema,
      z.array(JsonSchemaTypeNameSchema).min(1),
    ]),
  }),
  jsonSchemaDocument({ $ref: z.string().trim().min(1) }),
  jsonSchemaDocument({ oneOf: z.array(JSONValueSchema).min(1) }),
  jsonSchemaDocument({ anyOf: z.array(JSONValueSchema).min(1) }),
  jsonSchemaDocument({ allOf: z.array(JSONValueSchema).min(1) }),
  jsonSchemaDocument({ const: JSONValueSchema }),
  jsonSchemaDocument({ enum: z.array(JSONValueSchema).min(1) }),
]);

export const ActorTypeSchema = z.enum(["system", "team_member", "demo_reviewer"]);

export type ActorType = z.infer<typeof ActorTypeSchema>;
export type JsonSchemaDocument = z.infer<typeof JsonSchemaDocumentSchema>;

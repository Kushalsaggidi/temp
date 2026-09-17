import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import {
  JsonSchemaDocumentSchema,
  JSONValueSchema,
  type JsonSchemaDocument,
  type JSONValue,
} from "@/contracts";
import { sha256Digest } from "@/shared/integrity";

export interface SchemaValidationResult {
  valid: boolean;
  issues: readonly string[];
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
});

const validatorCache = new Map<string, ValidateFunction>();

function compile(schemaValue: JsonSchemaDocument): ValidateFunction {
  const schema = JsonSchemaDocumentSchema.parse(schemaValue);
  const key = sha256Digest(JSONValueSchema.parse(schema));
  const cached = validatorCache.get(key);
  if (cached) return cached;

  const validator = ajv.compile(schema);
  validatorCache.set(key, validator);
  return validator;
}

function describeIssue(issue: ErrorObject): string {
  const path = issue.instancePath || "/";
  switch (issue.keyword) {
    case "additionalProperties":
      return `${path} contains an unsupported field.`;
    case "required":
      return `${path} is missing a required field.`;
    case "type":
      return `${path} has the wrong value type.`;
    case "minLength":
    case "maxLength":
    case "minItems":
    case "maxItems":
      return `${path} is outside the allowed size.`;
    default:
      return `${path} does not satisfy the declared schema.`;
  }
}

export function validateAgainstSchema(
  schema: JsonSchemaDocument,
  value: JSONValue,
): SchemaValidationResult {
  const parsedValue = JSONValueSchema.safeParse(value);
  if (!parsedValue.success) {
    return { valid: false, issues: ["The value is not valid JSON data."] };
  }

  try {
    const validator = compile(schema);
    const valid = validator(parsedValue.data) === true;
    return {
      valid,
      issues: valid
        ? []
        : (validator.errors ?? []).slice(0, 5).map(describeIssue),
    };
  } catch {
    return {
      valid: false,
      issues: ["The registered schema could not be evaluated safely."],
    };
  }
}


import type { JSONValue } from "@/contracts";

/**
 * Minimal deterministic JSON encoding for contract data. Object keys are sorted,
 * arrays retain order, and unsupported/non-finite values are rejected by type or
 * JSON serialization. The resulting string is hashed as UTF-8.
 */
export function canonicalJson(value: JSONValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers.");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}


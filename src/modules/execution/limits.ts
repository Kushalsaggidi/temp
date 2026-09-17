import type { JSONValue } from "@/contracts";

export const EXECUTION_LIMITS = Object.freeze({
  requestBytes: 64 * 1024,
  inputBytes: 32 * 1024,
  outputBytes: 64 * 1024,
  timeoutMs: 2_000,
  jsonMaxDepth: 64,
  jsonMaxNodes: 10_000,
});

/**
 * Iterative preflight for untrusted request values. It runs before recursive
 * Zod/JSON-schema validation so deeply nested or cyclic values fail safely
 * without exhausting the JavaScript call stack.
 */
export function isJsonStructureWithinLimits(
  value: unknown,
  maxDepth = EXECUTION_LIMITS.jsonMaxDepth,
  maxNodes = EXECUTION_LIMITS.jsonMaxNodes,
): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;

  try {
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      nodes += 1;
      if (nodes > maxNodes || current.depth > maxDepth) return false;

      const item = current.value;
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))
      ) {
        continue;
      }
      if (typeof item !== "object" || seen.has(item)) return false;
      seen.add(item);

      if (Array.isArray(item)) {
        for (let index = 0; index < item.length; index += 1) {
          stack.push({ value: item[index], depth: current.depth + 1 });
        }
        continue;
      }

      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) return false;
      for (const key of Object.keys(item)) {
        stack.push({
          value: (item as Record<string, unknown>)[key],
          depth: current.depth + 1,
        });
      }
    }
  } catch {
    return false;
  }

  return true;
}

export function jsonByteLength(value: JSONValue): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

# Contract change request: preserve audience in interpreted discovery intent

## Requested change

Add an optional `audience` string to `InterpretedIntentItemSchema` in the canonical discovery
response contract.

## Why the current contract is insufficient

The discovery request accepts `optional_context.audience`, and retrieval uses it against the
canonical `audiences` catalog field. The response's interpreted-intent shape has domain and
desired output but cannot preserve audience. A clarification response therefore cannot round-trip
all normalized request context through the canonical response.

## Affected modules

- `src/contracts/discovery.ts` and generated JSON Schema artifacts
- discovery response fixtures and contract tests
- `src/modules/discovery/normalization.ts`
- consumers that render interpreted intent

## Compatibility

Making the field optional preserves existing producers and JSON payloads. Strict response
consumers must regenerate or update their accepted schema before discovery begins emitting it.
Until Agent 01 accepts the change, discovery uses audience for deterministic retrieval but does
not add an unofficial response field.

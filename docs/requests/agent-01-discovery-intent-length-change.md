# Contract change request: align discovery query and interpreted-goal lengths

## Requested change

Either raise `InterpretedIntentItemSchema.goal` from 500 to 1,000 characters, matching
`DiscoveryRequestSchema.query`, or explicitly define canonical truncation/summarization semantics.

## Why the current contract is insufficient

A valid 501-1,000 character request cannot be copied into a schema-valid interpreted intent.
Discovery currently uses a deterministic 500-character bounded representation so valid requests
do not become server errors. This preserves no invented content, but the truncation policy belongs
in the shared contract documentation.

## Affected modules

- `src/contracts/discovery.ts` and generated schemas
- discovery contract fixtures/tests
- `src/modules/discovery/normalization.ts`

## Compatibility

Raising the maximum is backward compatible for producers but may require strict consumers to
regenerate validators. Canonical truncation semantics would require no payload-shape change.

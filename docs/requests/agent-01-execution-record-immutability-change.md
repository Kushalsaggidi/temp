# Agent 04 -> Agent 01: execution-record database immutability request

Date: 2026-09-16  
Status: requested; not applied by Agent 04

## Requested migration

Please add a new canonical database migration, owned and reviewed by Agent 01,
that enforces the execution repository's append/transition rules at the SQLite
boundary:

- reject every `DELETE` from `executions`;
- reject updates to execution identity, asset/version identity, purpose,
  scenario label, executor key, definition digest, validated input, execution
  mode, model/configuration, and start timestamp;
- allow only `pending -> running|succeeded|failed|blocked` and
  `running -> succeeded|failed|blocked` status transitions;
- reject every update after `succeeded`, `failed`, `invalid`, or `blocked`;
- keep queryable columns and their matching values in `record_json` equal.

The feature repository already enforces these rules, validates every read, and
uses optimistic concurrency. Database triggers are still needed so a direct
SQL writer cannot rewrite or delete persisted provenance outside that
repository.

## Compatibility and verification

This should be additive and should not alter existing canonical contracts or
valid repository behavior. Please add migration tests that attempt direct SQL
mutation/deletion and confirm the trigger fails, then rerun:

```powershell
npm.cmd run contracts:check
npm.cmd test -- --run tests/database tests/execution/execution-repository.test.ts
```

Until Agent 01 accepts and applies this request, the handoff must state that
terminal immutability is enforced by the application repository but is not yet
defended against privileged direct SQL updates/deletes.

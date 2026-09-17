# Agent 04 -> Agent 01: preselection execution-mode provenance request

Date: 2026-09-16  
Status: requested; not applied by Agent 04

## Problem

The stable `ExecutionRecord` contract requires `execution_mode` to be one of
`deterministic`, `llm`, `retrieval`, or `agentic` for every status. A request
rejected before executor selection can target a version whose
`execution_kind` is `none`. The current service must therefore record the
service fallback `deterministic` on that blocked record, even though no
executor ran. Status, rejection reason, and validation result remain accurate,
but that mode is not selected-executor provenance.

## Requested contract decision

Please choose and canonically implement one of these representations:

1. allow `execution_mode: "none"` for `invalid`/`blocked` records rejected
   before executor acceptance; or
2. make `execution_mode` optional for those preselection terminal statuses and
   require it for `pending`, `running`, `succeeded`, and `failed` records.

Option 1 is preferred because it preserves a queryable explicit value. The
change requires Agent 01 ownership of the Zod contract, generated JSON Schema,
and compatibility decision. It does not require changing accepted-run or
successful-run provenance.

## Verification

Add a test for a direct API call to a `reference_only` / `execution_kind: none`
version and assert that the blocked record cannot imply an executor mode that
never ran. Then rerun contract generation/checks, execution tests, and the
production build.

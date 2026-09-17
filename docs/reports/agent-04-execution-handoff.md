# Agent 04 universal execution and reuse handoff

Date: 2026-09-16  
Owner: Agent 04 execution-system and reuse-evidence owner  
Status: implementation and development verification complete; frozen-subject evidence, human acceptance, governance, publication, and postpublication runs remain gated

This is a specialist handoff, not an official progress/evidence log. Agent 01 remains the only editor of `00_Admin/*`; Agent 05 owns governed evidence and publication decisions.

## Exact reviewed artifact identity

- Asset ID: `asset_property_ops_brief`
- Expected asset-version ID: `av_property_ops_brief_0_1_0_draft_1`
- Expected asset version: `0.1.0-draft.1`
- Executor key: `property_ops.brief_builder`
- Executor implementation version: `1.0.0`
- Definition digest: `sha256:be8b5c34fd414d32619f665398d9f710c18004c5f7644ea16e3e591198e2008e`
- Implementation digest: `sha256:d0c6bfd4c91b5aac42498776e7a21c637fc002cecb7be5b077c93e11a2380a48`
- Input-schema digest: `sha256:1ea2c4a2ac571e06a4015fda17850a541fe56d944bedff2c54d4b8c5d5b27a9c`
- Output-schema digest: `sha256:ebdf884e00491981a027de4416ffe557224dc49cf2a86db412a795d248f04577`
- Behavior-configuration digest: `sha256:1b64e4a524b8edcae835069faed5fd73546cb4c7c45afa44f384433ea864dac9`

Exact manifest:

```json
{
  "schema_version": "1.0.0",
  "executor_key": "property_ops.brief_builder",
  "implementation_version": "1.0.0",
  "implementation_digest": "sha256:d0c6bfd4c91b5aac42498776e7a21c637fc002cecb7be5b077c93e11a2380a48",
  "input_schema_digest": "sha256:1ea2c4a2ac571e06a4015fda17850a541fe56d944bedff2c54d4b8c5d5b27a9c",
  "output_schema_digest": "sha256:ebdf884e00491981a027de4416ffe557224dc49cf2a86db412a795d248f04577",
  "behavior_config_digest": "sha256:1b64e4a524b8edcae835069faed5fd73546cb4c7c45afa44f384433ea864dac9"
}
```

Reviewed artifacts:

- `src/modules/execution/executors/property-operations-brief/executor.ts`
- `src/modules/execution/executors/property-operations-brief/artifacts.ts`
- `src/modules/execution/executors/property-operations-brief/registration.ts`
- `src/modules/execution/executors/property-operations-brief/input.schema.json`
- `src/modules/execution/executors/property-operations-brief/output.schema.json`
- `src/modules/execution/executors/property-operations-brief/behavior-config.json`
- `src/modules/execution/executors/property-operations-brief/manifest.json`

## Proposed Agent 01 runnable metadata

Agent 01 should integrate these fields into the final unpublished hero content only after confirming the human owner and permissions:

```json
{
  "execution_kind": "deterministic",
  "availability": "runnable",
  "executor_key": "property_ops.brief_builder",
  "definition_digest": "sha256:be8b5c34fd414d32619f665398d9f710c18004c5f7644ea16e3e591198e2008e"
}
```

The final input and output schemas must remain byte-semantically equal to the reviewed JSON artifacts. Suggested truthful setup text is “Runs through the reviewed local deterministic executor without integrations.” Suggested maintenance text is “Any implementation, schema, or behavior change requires a new manifest, version, subject freeze, and evidence cycle.” Agent 01 must not copy the test-only permission values: a real human must confirm owner and permission fields.

After integrating all final content, Agent 01 must compute and freeze `subject_digest`, return the exact final asset version and artifact version, and make no later content change. `run-prepublication-reuse.ts` recomputes the subject digest and stops before execution if identity, availability, lifecycle, permissions, executor key, definition digest, subject digest, or either scenario differs.

## Delivered execution path

- Server-owned allowlist with startup and per-run recomputation of the normalized, path-labelled `artifacts.ts` + `executor.ts` + `registration.ts` implementation bundle, schemas, behavior configuration, manifest, and definition digest. The hashed registration binds the exact invoked function reference, capability denial, execution mode, and configuration without an unhashed invocation wrapper.
- Canonical JSON Schema 2020-12 input/output validation via Ajv.
- Central lifecycle, availability, permission, current-version, subject-digest, definition-digest, capability, high-impact, size, timeout, and secret checks.
- Pending → running → terminal persistence with safe invalid, blocked, failed, and succeeded outcomes.
- Public `POST /api/executions` that always uses `user_run`; the strict request rejects executor/purpose/module/script/URL injection and reads request streams through a hard byte ceiling before buffering.
- Code-only `prepublication_test` maintainer harness with no API/UI route.
- Public current-published-only Try page with safe structured result and provenance rendering.
- Current-subject evidence loader and reviewer-visible comparison derived from two persisted execution records; it independently requires the exact two frozen scenario fixtures, passing usefulness/safety checks, and an identical recorded configuration digest. Partial, substituted, or stale proof is suppressed.
- Frozen-subject evidence-candidate runner and local postpublication public UI/API verifier.

## Development verification (not publication evidence)

Completed locally:

- TypeScript: passed.
- Generated-contract drift: passed.
- Full suite: 22 files / 144 tests passed; two live gated runner files skipped by default.
- Focused execution suite covers schema, unit, persistence, API, failure, digest mismatch, source boundary, maintainer boundary, UI, and two-scenario reuse.
- Direct Next production build: passed and includes `/api/executions` and `/assets/[assetVersionId]/try`. Turbopack reports intentional server-output tracing warnings because readiness rereads reviewed source artifacts at runtime.
- Dependency audit: 0 known vulnerabilities across 172 dependencies (`npm.cmd audit --json`).
- Final independent read-only security audit: no remaining High-severity code defect. Its two residual persistence/provenance findings are the Agent 01-owned requests named under Current stop condition.
- The wrapper `npm.cmd run build` can fail before compilation on this host when nested `tsx` hits `uv_os_get_passwd ENOMEM`; standalone `npm.cmd run contracts:check` and `npx.cmd next build` both pass. This is a host/process issue, not a skipped product check.

Exact development commands:

```powershell
npm.cmd run typecheck
npm.cmd run contracts:check
npm.cmd test -- --run tests/execution
npm.cmd test
npx.cmd next build
npm.cmd audit --json
```

## Frozen-subject prepublication command

Run only after Agent 01 returns the final frozen unpublished runnable version:

```powershell
$env:RUN_PREPUBLICATION_EVIDENCE = "1"
npm.cmd test -- --run tests/execution/live-prepublication-handoff.test.ts
Remove-Item Env:RUN_PREPUBLICATION_EVIDENCE
```

The command uses the same asset ID, version ID, executor key, `ExecutionService.executePrepublication` entry point, JSON-schema validator, policy checks, repository, and core executor for both canonical scenarios. It emits JSON containing two distinct execution IDs, shared provenance, functional/usefulness/safety assertions, invalid/high-impact guardrail records, current-subject evidence candidates, and the persisted-record reuse comparison. It does not persist governance evidence; Agent 05 must validate and persist accepted candidates.

## Agent 05 and human-review handoff

Give the named human reviewer `docs/reports/agent-04-security-boundary.md`. No reviewer is currently named and no human acceptance is recorded. Automated checks must not become passing human/security evidence.

After the frozen runner passes, Agent 05 must verify that every evidence candidate uses Agent 01's unchanged final `subject_digest`, then record applicable functional, guardrail, reuse, source-permission, human, and human-accepted security evidence. Publication must change lifecycle/timestamps/current pointer only; it must not change version content, availability, executor metadata, schemas, scenarios, or digests.

## Postpublication public-path command

After Agent 05 publishes via a lifecycle-only transition, serve the same database locally:

```powershell
npm.cmd run dev
```

In a second PowerShell session:

```powershell
$env:RUN_PUBLIC_REUSE_VERIFICATION = "1"
$env:MARKETPLACE_BASE_URL = "http://127.0.0.1:3000"
npm.cmd test -- --run tests/execution/live-public-reuse.test.ts
Remove-Item Env:RUN_PUBLIC_REUSE_VERIFICATION
Remove-Item Env:MARKETPLACE_BASE_URL
```

The verifier requires the public Try UI to show the persisted current-subject reuse comparison, then executes both scenarios through the real public HTTP API. It rejects any mismatch in status, usefulness, safety, asset/version, executor key, or definition digest.

## Current stop condition

The canonical fixture remains Agent 01-owned and was deliberately not edited here. It is still `draft`, `reference_only`, unfrozen, permission-unconfirmed, and has no executor metadata. Therefore no real current-subject execution IDs, publication evidence, human security acceptance, or postpublication result are claimed in this handoff. The next legitimate action is Agent 01's exact metadata integration/freeze and return; not publication or evidence fabrication.

Application-level execution immutability and optimistic concurrency are implemented and tested. Direct privileged SQL can still alter/delete execution rows because the Agent 01-owned canonical migration has no execution immutability triggers. The additive migration request is recorded at `docs/requests/agent-01-execution-record-immutability-change.md`; this limitation remains open until Agent 01 applies it.

The stable execution contract also cannot express `execution_mode: none` (or an omitted mode) for a policy rejection that occurs before executor selection. The service records a deterministic fallback on such blocked records while accurately recording that no executor ran. Agent 01's contract decision is requested at `docs/requests/agent-01-preselection-execution-mode-change.md`.

Copy-ready official-state summary for Agent 01 (only Agent 01 may paste it): “Agent 04 delivered reviewed executor `property_ops.brief_builder` v1.0.0, definition digest `sha256:be8b5c34fd414d32619f665398d9f710c18004c5f7644ea16e3e591198e2008e`, fail-closed registry/service/API/UI/persistence, and gated frozen-subject/public reuse runners. Development checks pass 144 tests plus type/contract/build components and the dependency audit reports zero known vulnerabilities. This is not publication evidence; Checkpoint B freeze, the requested database-level execution immutability migration, named-human security/data acceptance, Agent 05 current-digest evidence, lifecycle-only publication, and real public reruns remain outstanding.”

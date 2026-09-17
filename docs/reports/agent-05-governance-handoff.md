# Agent 05 universal contribution and governance handoff

Date: 2026-09-16  
Owner: Agent 05 contribution-workflow and AI-governance owner  
Status: implementation and development verification complete; no catalog version was frozen, evidenced, approved, published, or deprecated as part of this work

This is a specialist handoff, not an official state or evidence log. Agent 01 remains the only editor of `00_Admin/*`. No official state file was edited.

## Outcome

The modular monolith now has a working human-reviewed contribution path with explicit lifecycle transitions, exact-subject evidence gates, append-only audit views, immutable published content, and a deliberately limited unauthenticated demo-review action. Contribution metadata cannot register or invent executable behavior. Publication changes only governance projection fields and the asset's current-published pointer; it never changes frozen version content, availability, executor identity, definition digest, artifact version, or subject digest.

The canonical bootstrap hero was not altered. It remains whatever Agent 01's canonical fixture and local database state declare. No reviewer identity, permission decision, security acceptance, execution outcome, or publication evidence was fabricated.

## Delivered module

- `src/modules/governance/`
  - Exact allowed graph: `draft -> submitted -> in_review -> changes_requested -> submitted`, `in_review -> published`, and `published -> deprecated`.
  - Unsupported transitions and system/AI lifecycle actors are rejected in the service.
  - Reviewer-owned transitions require an explicit `demo_reviewer` action in the unauthenticated prototype.
  - Lifecycle projection updates, current-published pointer changes, and append-only lifecycle-event insertion occur in one `BEGIN IMMEDIATE` transaction. A failed event insert rolls back the state change.
  - Evidence is persisted independently through the canonical immutable `evidence` table and remains bound to the exact frozen subject digest and artifact version.
  - The newest evidence of each type is authoritative. Older records are visibly superseded and cannot satisfy a gate. Failed, `needs_changes`, informational, false-assertion, stale-digest, stale-artifact, or otherwise non-passing evidence cannot satisfy publication.
  - Governance badges, gate state, review state, and merged audit history are derived from stored version, event, evidence, execution, and allowlist data.
  - Review projection distinguishes not reviewed, passed, failed/needs changes, and digest/artifact-expired needs refresh.
  - Optional AI is constrained to metadata suggestions and returns immutable `can_approve: false` / `can_publish: false` authority flags.

## Publication gates

Every version requires all of the following before `in_review -> published`:

1. A recomputable frozen `subject_digest` matching the exact immutable version content.
2. Resolved access, tool-use, and final-package permission decisions.
3. Newest current-digest/current-artifact metadata-validation evidence with `result: passed` and all assertions passing.
4. Newest current-digest/current-artifact named-human review evidence with `result: passed` and all assertions passing.
5. Newest current-digest/current-artifact source-permission evidence with `result: passed`; `not_applicable` is accepted only when the record and evidence explicitly document event-created synthetic material.
6. The same named human who supplied the passing current human-review record must perform the explicit publication action.

Runnable versions additionally require:

1. A server-allowlisted executor whose key and definition digest exactly match the frozen version.
2. Passing typical functional evidence referencing persisted terminal prepublication execution provenance for the exact asset/version.
3. Passing failure/guardrail evidence referencing persisted terminal prepublication execution provenance for the exact asset/version.
4. A passing, scoped security and data-handling review explicitly accepted by the same named human prepublication reviewer.

`reference_only` and `request_access` versions do not require execution gates and are never projected as runnable. A functional-test badge appears only when current passing functional evidence exists.

## Contribution and edit boundaries

- `POST /api/governance/contributions` creates a server-identified `draft` and an initial lifecycle event.
- Contribution input permits only `execution_kind: none` and `reference_only` or `request_access`; executor key and definition digest are not accepted.
- Draft/changes-requested edits cannot add executable behavior. Executor registration remains a maintainer-owned server allowlist action.
- Published/deprecated content cannot be edited in place. `POST /api/governance/versions/:id/draft` copies a previously published version into a new version ID/SemVer with lifecycle `draft`, null subject digest, no inherited evidence, and unchanged source content.
- Public catalog/detail/discovery behavior remains backed by the existing published-current-only catalog repository, so draft, submitted, in-review, changes-requested, and deprecated versions stay out of normal discovery.

## API and UI surface

- `POST /api/governance/contributions`
- `POST /api/governance/metadata-assistance`
- `GET /api/governance/versions`
- `GET|PATCH /api/governance/versions/:assetVersionId`
- `POST /api/governance/versions/:assetVersionId/transitions`
- `GET|POST /api/governance/versions/:assetVersionId/evidence`
- `POST /api/governance/versions/:assetVersionId/checks/metadata`
- `POST /api/governance/versions/:assetVersionId/demo-review`
- `POST /api/governance/versions/:assetVersionId/draft`
- `/contribute` now contains a real non-runnable contribution form with actionable errors and advisory metadata assistance.
- `/admin/governance` provides the review queue.
- `/admin/governance/:assetVersionId` provides lifecycle controls, exact gate state, evidence, derived badges, and merged history.

The generic evidence ingestion route accepts only system-produced functional, guardrail, and reuse evidence. Deterministic metadata validation has its own server action. Human, security, and source-permission outcomes use the prominently labeled manual demo-review action.

## Prototype limitation

Authentication and enterprise RBAC are intentionally absent. Reviewer names are manually entered, stored as `demo_reviewer` attestations, and visibly labeled as identity-unverified prototype records. The implementation does not claim organizational approval. Production use would require an authenticated identity adapter without weakening any digest, evidence, transition, or immutability rule.

## Verification

Focused governance coverage: 3 test files / 11 tests passed.

The governance tests cover:

- every allowed lifecycle transition;
- representative unsupported transitions and reviewer-only enforcement;
- atomic rollback when lifecycle-event insertion fails;
- missing, failed, informational, mismatched-digest, and superseded evidence;
- exact artifact/digest binding;
- reference-only publication without execution evidence;
- runnable executor binding, persisted functional execution, guardrail execution, and named-human security acceptance;
- lifecycle-only publication content/digest preservation;
- published immutability and distinct draft creation;
- public catalog exclusion before publication and after deprecation;
- actionable contribution validation;
- contribution inability to add executor behavior; and
- advisory-only AI authority plus honest UI labels.

Repository verification completed:

```powershell
npm.cmd run typecheck
npm.cmd run contracts:check
npm.cmd test -- --run tests/governance
npm.cmd test
npx.cmd next build
```

Results:

- TypeScript and Next route generation: passed.
- Canonical generated-contract drift: passed; no contract artifact changed.
- Focused governance suite: 3 files / 11 tests passed.
- Full suite: 25 files passed, 2 gated live-run files skipped; 155 tests passed, 2 skipped.
- Direct Next production build: passed and includes all governance API/UI routes.
- Turbopack repeated the two known execution-registry dynamic filesystem tracing warnings documented by Agent 04; no new compile error was introduced.
- The wrapper `npm.cmd run build` again stopped before compilation when nested `tsx` hit the already-documented Windows `uv_os_get_passwd ENOMEM` host failure. Its contract-check component passed independently, and the direct production build passed.

## Files and ownership

Implemented only in Agent 05-owned feature paths plus the assigned contribution page and this specialist report:

- `src/modules/governance/`
- `src/app/api/governance/`
- `src/app/admin/governance/`
- `src/components/governance/`
- `src/app/contribute/page.tsx`
- `tests/governance/`
- `docs/reports/agent-05-governance-handoff.md`

No file under `00_Admin/`, `src/contracts/`, `generated/contracts/`, `db/`, canonical catalog fixtures, execution implementation, discovery implementation, or official final-submission state was edited.

## Integration and stop condition

Agent 01 should integrate the final runnable hero content, reviewed executor identity, artifact version, and subject digest before any governed evidence is accepted. After that freeze, automated functional/guardrail/reuse candidates may be submitted through the evidence handler, and real named humans may use the explicit review actions. Any later content or behavior change requires a distinct version and a fresh digest/evidence cycle.

This handoff does not authorize publication. Publication becomes available only when the actual stored version and newest stored evidence satisfy every gate and the named passing human reviewer explicitly invokes it.

Copy-ready official-state summary for Agent 01 (only Agent 01 may paste it): "Agent 05 delivered the contribution/governance module, atomic lifecycle transitions and audit events, exact-subject evidence storage/projection, runnable publication gates, non-executable contribution boundary, immutable published-edit versioning, lifecycle/evidence APIs, contribution/review/history UI, and 11 focused governance tests. Full verification passes 155 tests plus type, contract-drift, and direct production-build checks. No official state, canonical contract, migration, fixture, reviewer identity, evidence claim, or catalog lifecycle was changed; final hero freeze, real current-digest evidence, named-human acceptance, and explicit publication remain outstanding."


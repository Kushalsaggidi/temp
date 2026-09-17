# IAM-03 - current status

**Last updated:** 2026-09-16 11:25 AM PT / 2026-09-16 23:55 IST
**Active editor:** Agent 01 (foundation owner and continuous integrator)
**Current artifact version:** application `0.1.0`; contract manifest `1.0.0`; migration `001_initial`; hero asset version `1.0.0`

**Event timeline:** Build work begins Wednesday, September 16, 2026. Final submission is due by 11:59 PM PT on Thursday, September 17, 2026. Judging/review runs September 18-25, 2026; winners will be announced during the September 30, 2026 Town Hall.

## Current goal

Finish the reviewer-facing package: confirm the human owner and prepublication reviewer names, place the working state in the Teams-connected SharePoint workspace, and record the measured before/after timing that the value claim will rest on.

## Completed since the last update

- Built a working governed marketplace on a Next.js 16 / React 19 / TypeScript modular monolith with one npm lockfile and one SQLite database. Optional AI is an additive port, never a startup dependency.
- Canonical Zod contracts in `src/contracts/` with generated JSON Schema 2020-12 artifacts, checked in CI by `npm run contracts:check`.
- Five modules: catalog, discovery, execution, governance, and investigation. Database triggers enforce append-only evidence and lifecycle, frozen-content immutability, and digest-bound evidence.
- **Fixed the demo-blocking gap:** `npm run db:reset` previously left the public catalog empty because it never seeded the published catalog. Reset now produces the full demo state.
- **The hero is genuinely runnable.** `av_property_ops_brief_1_0_0` is seeded as a frozen runnable draft, run twice through the real prepublication harness plus one fail-closed guardrail run, then published through the real gate-enforced publication path. Nothing asserts a state a gate did not check.
- **Reuse is proved from persisted records.** Two distinct succeeded executions of one unchanged frozen core, surfaced as a verified reuse comparison on the run page.
- Built the signature **Investigator**: trust scoring derived from publication gates, cross-version digest and gate comparison, a field-level content diff, an evidence trail that resolves to real rows, and recommended actions that call the same governance APIs a reviewer uses.
- Wired the previously dead metadata-assistance AI to a real, response-schema-locked adapter with a deterministic fallback, and added a contribution **Duplicate Guard** that reuses the discovery ranker.
- Completed a full UI redesign: one application shell, a semantic design system, trust rings, gate strips, lifecycle timelines, skeletons, toasts, and designed empty and error states.
- Rewrote `README.md`, which previously described only the bootstrap foundation and contradicted the running application.

## In progress

- Team coordinator - supply the Teams/SharePoint workspace links and confirm the human asset owner and named prepublication reviewer - `00_Admin/TEAM_CHARTER.md` - backup not assigned.
- Team - run the measured before/after timing for the hero workflow so any hours-saved figure is measured rather than estimated - not started.

## Next best action

- Team coordinator - confirm the IAM-03 SME contact and the Teams-connected SharePoint location, then place this repository's `03_Final_Submission/` content there. Local files alone are not a valid submission.

## Blockers or questions

**Use-case SME/contact:** IAM channel contacts are Austin.braham@realpage.com, erin.connolly@RealPage.com, Kim.Bowen@RealPage.com, tom.millard@Realpage.com, William.Allan@RealPage.com (not yet contacted by this team)
**Official SME directory:** [AI Hackathon Teams Channel Owner Addition List - 2026-09-11](https://realpage-my.sharepoint.com/:x:/r/personal/austin_braham_realpage_com/Documents/Documents/AI%20For%20All/Hackathon/Q3%20Hackathon/Logistics/AI%20Hackathon%20Teams%20Channel%20Owner%20Addition%20List%20-%202026-09-11.xlsx?d=w5676c79f2d35428ea52488d09457d511&csf=1&web=1&e=KuNuv9)

| Blocker or question | Why it matters | Owner or escalation | Needed by | Safe fallback |
| --- | --- | --- | --- | --- |
| Teams/SharePoint links and reviewer access are not yet recorded. | A package outside the team Teams channel is not a valid submission. | Team coordinator / Austin Braham | Before the 11:59 PM PT Sep 17 cutoff | Keep the repository complete and self-describing; move it as one unit once the location is confirmed. |
| Gemini is the configured optional provider, but the rules doc names Copilot, RPGPT, ChatGPT/Codex, and Claude. | A judge checking tool compliance could question the provider choice. | Team coordinator / IAM SME | Before submission | The product runs fully with `AI_PROVIDER=disabled`; every AI surface has a deterministic fallback, so the demo does not depend on it. |
| Human asset owner and named prepublication security/data reviewer are prototype attestations, not verified people. | Publication gates are satisfied by manually entered demo-reviewer names. | Team coordinator / governance owner | Before any claim of real approval | The UI states this limitation at every decision point; do not describe it as organizational approval. |
| No measured time saving has been recorded. | Hours saved is an explicit judging criterion. | Team product lead | Before submission | Claim nothing. The product asserts no hours-saved figure anywhere. |

## Test and evidence log

| Test ID | Approved input or scenario | Expected behavior | Actual result | Pass / fail | Evidence link | Reviewer | Artifact version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Typical case: run the hero from `/assets/av_property_ops_brief_1_0_0/try` with three synthetic observations | A succeeded execution with a unique ID, frozen version, executor key, and definition digest | Status `succeeded`; executor `property_ops.brief_builder`; observations preserved verbatim; limitations carried into the output | Pass | `tests/investigation/demo-seed.test.ts`, live probe of `POST /api/executions` | Automated checks / Agent 01 | hero `1.0.0` |
| T-02 | Missing or ambiguous input: submit the hero with no `observations` array | Reject at input validation, produce no output, fail closed | Status `invalid`; `output` undefined; input-stage validation recorded as failed; guardrail evidence written | Pass | `tests/investigation/demo-seed.test.ts`; seeded guardrail execution | Automated checks / Agent 01 | hero `1.0.0` |
| T-03 | Guardrail case: ask discovery to "approve or deny an applicant" | Redirect the high-impact decision to a human rather than recommending an asset | Guardrail response with a stated reason and human-review point; no candidates returned | Pass | `tests/discovery/discovery.test.ts` | Automated checks / Agent 01 | application `0.1.0` |
| T-04 | Reuse: two different scenarios against one unchanged frozen core | Two distinct succeeded execution IDs verifiable from persisted reuse evidence | Comparison available; distinct execution IDs and scenario labels; `core_implementation_unchanged` true | Pass | `tests/investigation/demo-seed.test.ts`; run page reuse panel | Automated checks / Agent 01 | hero `1.0.0` |
| T-05 | Investigation of `av_resident_comms_1_1_0` | Report the gate and digest gap against version 1.0.0 without asserting an unverified fact | Trust 100 → 50; human review and source permission missing on the current version; digests differ; eight changed content fields listed; inference labelled unverified | Pass | `tests/investigation/investigation.test.ts`; `GET /api/investigate/av_resident_comms_1_1_0` | Automated checks / Agent 01 | application `0.1.0` |
| T-06 | Act: flag the investigated version for re-review | Real state change; the asset leaves public discovery | Lifecycle event appended; version deprecated; public catalog 9 → 8; the asset no longer returned by discovery | Pass | Live probe of `POST /api/governance/versions/.../transitions` then `GET /api/catalog` | Automated checks / Agent 01 | application `0.1.0` |
| T-07 | No-key fallback: run discovery and an investigation with `AI_PROVIDER=disabled` | Both work and label the deterministic path | Deterministic ranking and the deterministic interpretation are returned and visibly labelled | Pass | `tests/discovery/discovery.test.ts`, `tests/investigation/investigation.test.ts` | Automated checks / Agent 01 | application `0.1.0` |
| T-08 | Full gate: `npm run typecheck && npm run contracts:check && npm test && npm run build` | Types, generated contracts, tests, and production build agree | Typecheck clean; contracts match; 171 tests across 27 files pass (2 live-network suites skipped); production build succeeds | Pass | `npm run verify` | Automated checks / Agent 01 | application `0.1.0` |

Current seeded state: 9 published assets, 32 evidence records, 3 persisted executions, 14 lifecycle events.

## Links

- Team charter: `00_Admin/TEAM_CHARTER.md` (human details still blank)
- Decision log: `00_Admin/DECISIONS.md`
- Current handoff: `00_Admin/HANDOFF.md`
- Sponsor inputs: `01_Sponsor_Inputs/`
- Final submission folder: `03_Final_Submission/`
- Shared FAQ or current event post: Not supplied

## Safety reminder

Do not make or automate customer, employee, employment, compensation, performance, legal, or production decisions or actions. Keep a human reviewer in the loop.

# Handoff — RealPage AI Marketplace

Companion to [README.md](README.md). See also [DEMO_STEPS.md](DEMO_STEPS.md) and [SOURCES_AND_PERMISSIONS.md](SOURCES_AND_PERMISSIONS.md). This document does not repeat the full README — it focuses on operational status, what is proven versus unproven, and how to run and maintain the prototype.

## 1. Handoff summary

| Field | Value |
| --- | --- |
| Project | RealPage AI Marketplace |
| Team / channel | Q3 AI Hackathon-IAM-03 |
| Artifact version | Application `0.1.0` · contract manifest `1.0.0` · migration `001_initial` · hero asset version `1.0.0` |
| Status | Hackathon prototype |
| Final location | This repository, `AI_marketplace/` (root); primary entry point [`README.md`](README.md) |
| Artifact owner | `[TODO: Not assigned — 00_Admin/TEAM_CHARTER.md's roster/roles table is blank]` |
| Presenter | `[TODO: Not documented in this repository]` |
| Reviewer access checker | `[TODO: Not assigned — no non-owner fresh-install check has been recorded]` |
| Completion timestamp (PT) | `[TODO: Record before the 11:59 PM PT, Thursday, September 17, 2026 submission cutoff — see 03_Final_Submission/FINAL_SUBMISSION_CHECKLIST.md]` |
| Last verified timestamp (PT) | `[TODO: Record when this document's Final Verification Record (Section 13) is actually completed]` |

## 2. Product summary

- **Intended user:** RealPage employees and teams who build reusable AI assets but currently have no shared way to find or evaluate each other's work.
- **Problem:** Useful assets stay isolated in personal files or team folders; people cannot easily tell what already exists, whether it is trustworthy, or who owns it.
- **Primary workflow:** Find an asset (browse or natural-language discovery) → understand it (purpose, audience, inputs/outputs, limitations, owner) → review its trust score and governance evidence → reuse it if ready, or investigate and act if it needs attention.
- **Demonstrated result:** A working Next.js application with a real SQLite-backed catalog, deterministic trust/governance scoring, natural-language discovery, an Investigator that explains trust drift from persisted evidence, and one hero asset that has genuinely run against two different scenarios with distinct persisted execution records.
- **What the prototype intentionally does not do:** it does not implement authentication, does not use real customer or production data, does not let AI approve or publish anything, does not measure real business value, and does not claim production readiness.

## 3. Implementation-status matrix

| Area | Status | What works | Limitation | Evidence |
| --- | --- | --- | --- | --- |
| Overview | Working | Catalog health counts (published, verified, runnable, needs attention) at `/` | Synthetic data only | `src/app/page.tsx` |
| Marketplace browsing | Working with synthetic data | Browse and filter the seeded catalog at `/marketplace` | Catalog is synthetic; 9 published assets | `fixtures/catalog/published-catalog.ts` |
| Search and filtering | Working with synthetic data | Filtering over the seeded catalog | Same as above | `src/components/marketplace/marketplace-browser.tsx` |
| Natural-language discovery | Working with synthetic data | Deterministic ranked matching at `/discovery`, with an optional AI term-expansion assist | Ranking logic, not the AI, decides matches; AI cannot alter results | `src/modules/discovery/`; `tests/discovery/discovery.test.ts` |
| Asset details | Working with synthetic data | Purpose, audience, capabilities, inputs/outputs, limitations, owner | Synthetic content | `src/app/assets/[assetVersionId]/page.tsx` |
| Trust score | Working with synthetic data | Computed from weighted governance gates against persisted evidence | Not a universal guarantee; scoped to one asset version | `src/modules/governance/` |
| Governance checks | Working with synthetic data | Human review, security review, source-permission, functional validation, guardrail behavior, reuse-evidence gates | Reviewer names are manually entered demo attestations, not identity-verified | `db/migrations/001_initial.sql`; `src/modules/governance/repository.ts` |
| Investigation | Working with synthetic data | Explains trust drift (e.g., 100 → 50 for Resident Communication Planner) with a field-level content diff | AI commentary is labeled "not verified"; facts come from `trust.ts`, not the model | `src/modules/investigation/trust.ts`; `tests/investigation/investigation.test.ts` |
| Lifecycle history | Working with synthetic data | Lifecycle timeline per asset version | Synthetic events only | `src/modules/governance/` |
| AI interpretation | Working with synthetic data | Optional Gemini calls for discovery-term expansion, investigation commentary, contribution-metadata drafting | Schema-locked, cannot assert facts or approvals; disabled by default | `src/modules/discovery/adapter.ts` |
| Rule-based fallback | Working | Deterministic path for every AI-touched surface when `AI_PROVIDER=disabled` or the provider fails | None known | `tests/discovery/discovery.test.ts`, `tests/investigation/investigation.test.ts` |
| Similar-asset discovery | Working with synthetic data | Alternatives surfaced through the same discovery ranker | Synthetic catalog only | README.md § capability table |
| Data persistence | Working with synthetic data | Real SQLite database with append-only evidence and immutable frozen content | Single local file, not a production database | `db/migrations/001_initial.sql` |
| Authentication | Not implemented | — | No login, roles, or access control of any kind | README.md § Limitations |
| Tests | Working | 266 tests passed across 33 files (2 live-network suites skipped), independently reproduced during preparation of this document | Live-network suites are skipped without external credentials | `npm test` output |
| Deployment | Not implemented | `npm run build` / `npm start` exist and are exercised by CI | No hosted or production deployment exists | `.github/workflows/ci.yml` |
| Documentation | Working | README.md, this document, DEMO_STEPS.md, SOURCES_AND_PERMISSIONS.md, and internal `00_Admin/` records | Official `03_Final_Submission/` and `00_Admin/TEAM_CHARTER.md` templates remain blank | Direct file inspection |

## 4. Completed work

**Product experience:** Overview, marketplace browsing, natural-language discovery, asset detail, governance, investigation, contribution walkthrough, and the AI Operator (`/control`, `/agents`) — all reachable and functioning against the seeded database.

**Technical implementation:** Next.js 16 / React 19 / TypeScript application; Node's built-in `node:sqlite` persistence with ordered raw-SQL migrations; canonical Zod contracts with generated JSON Schema 2020-12 artifacts checked for drift in CI (`.github/workflows/ci.yml`).

**Catalog content:** 9 published synthetic assets in `fixtures/catalog/published-catalog.ts`, including the runnable hero (Property Operations Brief Builder) and reference-only entries such as Capital Project Intake Template.

**Governance behavior:** Deterministic trust scoring from persisted evidence; the Investigator's field-level trust-drift explanation, demonstrated on Resident Communication Planner (trust 100 → 50 between content versions `1.0.0` and `1.1.0`).

**Testing:** 35 Vitest suites (`tests/`), covering contracts, database, discovery, execution, governance, insights, integration, integrity, investigation, and operator behavior. Reproduced result: 266 passed, 2 skipped, 33 files, run during preparation of this document.

**Documentation:** `README.md` (primary judge-facing document), this handoff, `DEMO_STEPS.md`, `SOURCES_AND_PERMISSIONS.md`, and internal engineering records in `00_Admin/` (`STATUS.md`, `HANDOFF.md`, `DECISIONS.md`) and `docs/reports/`.

## 5. Incomplete or unproven work

- **Unimplemented features:** authentication and access control; any production deployment.
- **Untested behavior:** a fresh-install check by a teammate who did not build the feature has not been recorded (`[TODO]`, per README.md's evidence table).
- **Synthetic or mocked integrations:** the entire catalog, governance evidence, and execution history are synthetic; reviewer names are manually entered demo attestations, not identity-verified.
- **Known bugs:** none documented in this repository as of this writing; `00_Admin/docs/reports/foundation-verification.md` notes one local environment flake (`tsx` intermittently hitting `uv_os_get_passwd returned ENOMEM` on one Windows host during a verification run) — an environment issue, not a code defect, and not reproduced during preparation of this document.
- **Accessibility gaps:** `[TODO: No accessibility review has been performed or documented in this repository.]`
- **Performance questions:** `[TODO: No load or performance testing has been performed or documented.]`
- **Security requirements:** a formal production security review is explicitly out of scope for this prototype (README.md § Limitations).
- **Permission questions:** sponsor-brief redistribution and the Gemini API's data-sharing approval remain open — see [SOURCES_AND_PERMISSIONS.md § 10](SOURCES_AND_PERMISSIONS.md#10-open-permission-questions).
- **Production requirements:** approved authentication, persistent production-grade storage, and a formal security/permissions review are all still needed (README.md § What is next).
- **External dependencies:** the optional Google Gemini API — never required to run, build, or test the application, and every consuming surface has a deterministic fallback.

## 6. Setup and operation

Commands are taken directly from `package.json` and verified during preparation of this document.

- **Prerequisites:** Node.js `24.21.0` (see [`.nvmrc`](.nvmrc); `node:sqlite` requires Node 24), npm `11.19.0`.
- **Dependency installation:** `npm ci`
- **Environment configuration:** `cp .env.example .env` (leave `AI_PROVIDER=disabled` unless a Gemini key is available and its use has been confirmed — see [SOURCES_AND_PERMISSIONS.md](SOURCES_AND_PERMISSIONS.md))
- **Synthetic-data setup:** `npm run db:reset`
- **Start command:** `npm run dev`
- **Build command:** `npm run build`
- **Test command:** `npm test` (full gate: `npm run verify`, which chains typecheck + contract-drift check + tests + build)
- **Local URL:** `http://localhost:3000`
- **Reset/stop procedure:** stop the dev server with Ctrl+C; re-run `npm run db:reset` to restore a clean seeded state.
- **Required account, role, or license:** none for the default (AI-disabled) experience.

## 7. Review and fallback path

- Start with [`README.md`](README.md) for the full judge-facing overview.
- Use [`DEMO_STEPS.md`](DEMO_STEPS.md) to run the live demonstration.
- Use [`SOURCES_AND_PERMISSIONS.md`](SOURCES_AND_PERMISSIONS.md) for data and permission questions.
- Test evidence: [`00_Admin/STATUS.md`](00_Admin/STATUS.md) and the reproduced `npm test` result in this document (Section 3).
- Screenshots / backup video: `[TODO: none exist in this repository as of this writing — see DEMO_STEPS.md § 8]`.
- Final checklist: [`03_Final_Submission/FINAL_SUBMISSION_CHECKLIST.md`](03_Final_Submission/FINAL_SUBMISSION_CHECKLIST.md) (currently unfilled — see Section 12).

**When everything works normally:** follow `DEMO_STEPS.md` directly; no fallback needed.

**When external AI is unavailable:** no action needed — the default configuration (`AI_PROVIDER=disabled`) never calls it, and every AI-touched surface has a deterministic fallback that is part of the normal demo path, not a special-case recovery.

**When installation fails:** confirm the Node/npm versions match Section 6 exactly, and confirm `package-lock.json` is present and unmodified.

**When an external link cannot be opened:** every primary-path step in `DEMO_STEPS.md` is local (`localhost:3000`); avoid relying on any external link during a live review.

## 8. Important design decisions

| Decision | Reason | Consequence |
| --- | --- | --- |
| Governance facts are computed deterministically from persisted evidence, never asserted by a model | So a judge or reviewer can trace every trust score and gate outcome back to a database row | The AI layer can only explain and suggest; it cannot author a governance fact |
| AI can explain but cannot approve | To keep human review meaningful and prevent the AI from creating false confidence | Every write action (publish, approve, change lifecycle state) requires an explicit human confirmation |
| A rule-based fallback exists everywhere AI touches the product | So the demo and the product never depend on model availability | Discovery, investigation, contribution suggestions, and operator routing all work with `AI_PROVIDER=disabled` |
| Synthetic data is used for safe demonstration | To avoid any customer or production data exposure during a hackathon | The catalog realistically resembles RealPage domains but is not real; no measured real-world outcome can be claimed |
| Reference-only assets are separated from runnable ones | Most of the catalog is reference-only so the one runnable hero asset could be built to a higher evidence standard, rather than shipping many shallow "runnable" assets | Only Property Operations Brief Builder is actually executable end-to-end |
| Human review remains required | Central safety principle of the prototype | No lifecycle transition or approval happens without explicit human confirmation |
| Reviewability was prioritized over production complexity | One modular monolith, one SQLite database, one lockfile — to keep the whole system reviewable in the judging window | The architecture is deliberately simple and not representative of a production deployment topology |

Source: `00_Admin/DECISIONS.md` and README.md § Challenges and decisions.

## 9. Known limitations and risks

| Priority | Limitation or risk | Impact | Current mitigation | Recommended action |
| --- | --- | --- | --- | --- |
| High | No production authentication | Anyone with local access can use every feature, including write actions behind the operator's confirmation step | Confirmation step still required for every write; no production deployment exists | Add approved authentication and authorization before any pilot |
| High | No formal production security review | Unknown security posture beyond what tests and code review cover | Deterministic, schema-locked AI boundaries; no secrets in the repository | Formalize a security review before any pilot or wider access |
| Medium | Manual reviewer names / synthetic records | Reviewer names in evidence records could be mistaken for real approvals | Explicitly disclosed as demonstration fixtures in README.md and SOURCES_AND_PERMISSIONS.md | Replace with real, permissioned contributor identity before production use |
| Medium | Limited persistence (single local SQLite file) | No production-grade durability, backup, or multi-user concurrency | Adequate for a single-presenter local demo | Add approved persistent storage for any pilot |
| Medium | Reference-only assets dominate the catalog | Only one asset is genuinely runnable; the "marketplace" breadth is mostly inspectable, not executable | Explicitly labeled `reference_only` in the UI and documentation | Expand the number of genuinely runnable, governed executors over time |
| Medium | External model (Gemini) availability and data-sharing approval | The optional AI enhancement depends on an external service whose approval status for this data classification is unconfirmed | AI is disabled by default and never required | Confirm data-sharing approval before enabling `AI_PROVIDER=gemini` outside the local demo |
| Low | No production pilot | Business value (time saved, adoption, reuse rate) has not been measured against real usage | Explicitly disclosed; no figure is asserted | Run a small internal usability pilot with real users |
| Low | No commit history in this repository as of this writing | Cannot yet reference a specific submission commit/version | `[TODO: Confirm the final submission commit/tag once one exists]` | Establish version control history before or at submission |

## 10. Maintenance guidance

- **Catalog entries:** stored in [`fixtures/catalog/published-catalog.ts`](fixtures/catalog/published-catalog.ts) (built via the shared `buildEntry()` helper) and [`fixtures/catalog/bootstrap-draft.json`](fixtures/catalog/bootstrap-draft.json).
- **Adding assets:** add a new entry to `published-catalog.ts` following the existing `buildEntry()` pattern, then re-run `npm run db:reset` to reseed.
- **Versions:** represented as immutable, frozen content with a server-owned `subject_digest`; any content change requires a new version and invalidates earlier review evidence (README.md § Architecture, "Canonical identity and immutability").
- **Governance records:** stored in the SQLite database via migrations in [`db/migrations/`](db/migrations/) and managed through [`src/modules/governance/`](src/modules/governance/).
- **Updating fixtures:** edit files under `fixtures/`, then run `npm run db:reset` to reseed the local database.
- **Running tests:** `npm test` (full suite) or `npm run evaluate:discovery` (discovery-ranking evaluation against `docs/evaluation/`).
- **Updating documentation:** edit `README.md`, this file, `DEMO_STEPS.md`, or `SOURCES_AND_PERMISSIONS.md` directly; keep terminology (Working, Reference only, Synthetic, Human review, Trust score, Governance) consistent across all four documents.
- **Governance review required before changes to:** `src/modules/governance/`, `src/contracts/governance.ts`, and any change to how trust scores or gate outcomes are computed — these are the deterministic core the entire safety story depends on.

## 11. Ownership and contacts

Team:

- Saggidi Kushal
- Kelly Goldsborough
- Gavidi Suhita
- Supriya Janjirala
- Loven Ybanez

`[TODO: Individual role/workstream assignments are not documented in this repository — 00_Admin/TEAM_CHARTER.md's roster table is blank.]`

Official use-case contacts:

- Austin Braham — [Austin.braham@realpage.com](mailto:Austin.braham@realpage.com) — event-support contact for submission-location or reviewer-access issues
- Kim Bowen — [Kim.Bowen@RealPage.com](mailto:Kim.Bowen@RealPage.com)
- William Allan — [William.Allan@RealPage.com](mailto:William.Allan@RealPage.com)
- Erin Connolly — [erin.connolly@RealPage.com](mailto:erin.connolly@RealPage.com)
- Tom Millard — [tom.millard@Realpage.com](mailto:tom.millard@Realpage.com)

## 12. Recommended actions

### Before submission

- Fill required TODOs in this document, `DEMO_STEPS.md`, and `SOURCES_AND_PERMISSIONS.md`.
- Confirm artifact version and assign an accountable artifact owner.
- Test a fresh installation on a machine that did not build the feature.
- Verify teammate access to the final submission location.
- Open every relative link in these three documents and in `README.md`.
- Create and test backup demo materials (none currently exist — see `DEMO_STEPS.md` § 8).
- Scan the repository for secrets one more time immediately before submission.
- Complete `03_Final_Submission/README.md` and `03_Final_Submission/FINAL_SUBMISSION_CHECKLIST.md` (both are currently blank templates).

### After the hackathon

1. Conduct a small internal usability pilot.
2. Confirm product and technical ownership.
3. Validate contribution and publishing workflows.
4. Add approved authentication and authorization.
5. Add approved persistent storage.
6. Formalize security and permission reviews.
7. Replace synthetic records with permissioned contributions.
8. Measure adoption, reuse, time saved, and review quality.

No production deployment is promised or planned as part of this hackathon submission.

## 13. Final verification record

| Check | Result | Checked by | Timestamp (PT) | Notes |
| --- | --- | --- | --- | --- |
| Fresh installation | `[TODO: Not yet performed by a non-author teammate]` | `[TODO]` | `[TODO]` | See Section 12 |
| Startup | Confirmed working (`npm run dev`, local verification) | `[TODO: Name the verifier]` | `[TODO]` | — |
| Original scenario (discovery: "prepare a property operations review") | Confirmed working, returns Turnover Readiness Checklist per `docs/evaluation/discovery-set-v2.json` | `[TODO]` | `[TODO]` | See `DEMO_STEPS.md` |
| Second reuse scenario (discovery: "help with tenant updates") | Confirmed working, returns Resident Communication Planner per `docs/evaluation/discovery-set-v2.json` | `[TODO]` | `[TODO]` | See `DEMO_STEPS.md` |
| Governance scenario (Resident Communication Planner trust drift) | Confirmed working via automated test | `[TODO]` | `[TODO]` | `tests/investigation/investigation.test.ts` |
| AI-unavailable fallback | Confirmed working via automated test and by default configuration | `[TODO]` | `[TODO]` | `tests/discovery/discovery.test.ts`, `tests/investigation/investigation.test.ts` |
| Tests | 266 passed, 2 skipped, 33 files | `[TODO: Name the verifier]` | `[TODO]` | Reproduced during preparation of this document |
| Relative links | `[TODO: Not yet independently re-verified after final edits]` | `[TODO]` | `[TODO]` | — |
| Backup materials | Not applicable — none exist | `[TODO]` | `[TODO]` | See `DEMO_STEPS.md` § 8 |
| Secrets scan | No secrets found in tracked files during preparation of this document | `[TODO: Name the verifier for a final pre-submission scan]` | `[TODO]` | See `SOURCES_AND_PERMISSIONS.md` § 9 |
| Teams/SharePoint access | `[TODO: Not yet verified]` | `[TODO]` | `[TODO]` | `03_Final_Submission/` templates are currently blank |
| Final artifact version | Application `0.1.0` · contract manifest `1.0.0` · migration `001_initial` · hero asset version `1.0.0` | — | — | Consistent with `README.md` |

## 14. Final handoff statement

What is ready for judging: a working prototype that demonstrates finding, verifying, and reusing an AI asset across two different scenarios, with governance facts computed from persisted evidence and a deterministic fallback for every AI-touched surface. What remains unproven: real-world business value, a non-owner fresh-install check, and several submission-coordination items (official templates, backup demo material, artifact ownership). The recommended next decision is to complete the pre-submission checklist in Section 12 and, after judging, evaluate a small internal pilot rather than any production commitment. Future changes made after this handoff is finalized are not part of this frozen hackathon submission.

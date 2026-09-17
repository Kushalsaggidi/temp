# RealPage AI Marketplace

**Find. Verify. Reuse.**

> A governed internal marketplace that helps RealPage employees discover reusable AI assets, understand their limitations, and determine what is ready to use before rebuilding work from scratch.

| | |
| --- | --- |
| **Team / channel ID** | Q3 AI Hackathon-IAM-03 |
| **Use case** | Building a RealPage AI Marketplace |
| **Artifact version** | Application `0.1.0` · contract manifest `1.0.0` · migration `001_initial` · hero asset version `1.0.0` |
| **Prototype status** | Hackathon prototype — built September 16–17, 2026 |

This README is the judge- and reviewer-facing entry point; deeper technical detail (module ownership, contract rules, command reference) is folded into the sections below rather than split into a second file.

---

## The 60-second version

- **Who:** RealPage employees and teams who build reusable AI assets (templates, workflows, dashboards, skills, agents) but have no shared way to find or evaluate each other's work.
- **Problem:** Useful assets sit isolated in personal files and team folders. Nobody outside the creator can easily tell what an asset does, whether it is trustworthy, or who owns it.
- **What we built:** A working Next.js application with a real SQLite-backed catalog, a trust-scoring and governance engine, a natural-language discovery and "Investigator" experience, and an optional AI layer that degrades to deterministic behavior when disabled.
- **What you can demonstrate today:** Browse and search a seeded catalog, run a real hero asset twice against two different scenarios, investigate why a specific asset's trust score dropped, and act on that finding — all backed by real database records, not scripted text.
- **What makes it reusable:** The same frozen asset and executor accepted two materially different inputs (a property-operations scenario and a resident-communications scenario) without any code change, proving the packaging pattern generalizes.
- **Central safety principle:** Governance facts are computed deterministically from persisted evidence. AI may explain and suggest, but it can never author a trust score, an approval, or a lifecycle change — a human always approves the consequential step.

---

## The problem

Across RealPage, people build genuinely useful AI assets — templates, prompts, dashboards, small agents — but this work stays isolated in individual files, personal notes, or team-specific folders. There is no shared place to discover what already exists before starting similar work again.

That isolation creates practical consequences:

- **Duplicated work** — people rebuild something a colleague already made.
- **Inconsistent documentation** — assets that do exist rarely describe their purpose, inputs, outputs, or limitations the same way twice.
- **Unclear ownership** — nobody knows who to ask when an asset behaves unexpectedly or needs updating.
- **Unclear permissions and limitations** — it's hard to tell what an asset is actually allowed or safe to be used for.
- **Difficulty judging readiness** — a document that "looks done" and one that has actually passed review can look identical from the outside.
- **Limited reuse across teams** — a pattern proven in one domain rarely reaches another, because there's no catalog connecting them.

## The solution

The marketplace turns "does something like this already exist, and can I trust it?" into an answerable question, with a consistent workflow:

1. **Find** an existing asset through catalog browsing, filtering, or a natural-language description of the need (Discovery).
2. **Understand** what it does — purpose, audience, inputs, outputs, limitations, and named owner, all on the asset-detail page.
3. **Review** its trust score and governance checks before relying on it.
4. **Check** evidence and freshness — is the review behind the current content, or current?
5. **Reuse** it directly when it is ready, or **Investigate** it when something needs attention.
6. **Find an alternative** (similar-asset discovery) when the current asset isn't ready for the job.

This vocabulary — Find, Trust, Investigate, Prove, Act, Reuse — is the product's own terminology, drawn directly from its UI.

---

## What the prototype demonstrates

| Capability | What the user can do | Demonstration status |
| --- | --- | --- |
| Browse the marketplace | View catalog health (published, verified, runnable, needs attention) from real governance records at `/` | Working |
| Search and filter the catalog | Browse and filter the seeded catalog | Working with synthetic data |
| Describe a need in natural language | Query `/discovery` and see hybrid semantic + deterministic ranked matches | Working with synthetic data |
| View ranked matches and why they matched | Each match shows which canonical fields matched | Working with synthetic data |
| View an asset's details | Purpose, audience, inputs, outputs, limitations, owner on the asset page | Working with synthetic data |
| View trust and governance checks | Trust score and gate-by-gate governance status per asset version | Working with synthetic data |
| Investigate missing or stale evidence | The Investigator explains a trust drop (e.g., 100 → 50) with a field-level content diff | Working with synthetic data |
| View lifecycle history | Lifecycle timeline per asset version | Working with synthetic data |
| Find similar / alternative assets | Alternatives surfaced through the same discovery ranker | Working with synthetic data |
| Reuse across two different scenarios | One frozen hero asset version runs two materially different scenarios, both persisted with distinct execution IDs | Demonstrated |
| Rule-based fallback when AI is unavailable | Discovery, Investigator, contribution review, and the AI Operator all fall back to deterministic logic with `AI_PROVIDER=disabled` | Demonstrated with fallback |
| Act on a governance finding | "Flag for re-review" appends a real lifecycle event, deprecates the version, and removes it from public discovery | Working with synthetic data |
| Natural-language operator (AI Control Center) | Ask for any of the above in plain language at `/control`, with a preview before any state change | Working with synthetic data |
| Contribution walkthrough | Draft → freeze → validate → submit a new asset, each step verified against the database | Working with synthetic data |
| Production authentication / access control | Not implemented — see [Limitations](#limitations) | Not implemented |

All catalog content shown above is synthetic, created for the event. No customer or production data is used anywhere in the prototype.

---

## Demo journey

The current catalog and code support the following walkthrough. It does not require the original developers to run.

### Scenario 1: Property operations (the hero asset)

Open **`/assets/av_property_ops_brief_1_0_0/try`**. This asset — the Property Operations Brief Builder — is the one hero asset that went through the full real publication path (freeze → executor manifest → governance gates → publish), not just a catalog entry.

- Run it with the first synthetic scenario (a maintenance work-order backlog for a regional operations reviewer).
- The result is a real, persisted execution: a unique execution ID, the frozen asset version, the allowlisted executor, and the content's definition digest.

### Scenario 2: A second, different domain — proving reuse

On the same page, the run history shows a **second** persisted execution of the identical frozen asset version and executor, against a materially different input (an energy/utility-variance scenario for a sustainability analyst). Same core, same digest, two different real outputs — this is the reuse proof, read directly from stored records rather than re-generated on demand.

### Governance scenario: verified vs. needs attention

- **Ready/verified example:** the hero asset (`av_property_ops_brief_1_0_0`) shows full governance coverage and a high trust score.
- **Needs-attention example:** open the Investigate action on *Resident Communication Planner*. Its trust score drops from 100 to 50 because:
  - **What the user sees:** a trust-score change flagged on the asset.
  - **Why it needs attention:** the version's human and security review were recorded against content version `1.0.0`, but the currently published content is version `1.1.0` — a different digest.
  - **What evidence is missing/stale:** the review evidence no longer matches the digest of the content a user would actually receive; eight content fields changed between versions.
  - **Recommended action:** flag the asset for re-review.
  - **Why human review still matters:** the Investigator only reports facts read from the database and labels its one AI-generated inference as *not verified* — a human reviewer, not the AI, decides and executes the re-review action.

Following through on **Act** (via the Investigator's "Flag for re-review") appends a real lifecycle event, deprecates that version, and removes it from public discovery — a genuine state change, not a simulated one.

`[TODO: Add final DEMO_STEPS.md link]` — no standalone `DEMO_STEPS.md` file exists in this repository at the time of writing; the walkthrough above is sourced from the demo-path table in this README and verified directly against the seeded database.

---

## Why this matters to RealPage

- The prototype **demonstrates** that a single frozen asset can be packaged once and reused, unmodified, for two materially different business scenarios — evidence that a governed marketplace pattern can generalize across domains.
- The prototype **demonstrates** that trust and governance state can be computed deterministically from evidence rather than asserted, and that an AI layer can explain that state without being able to alter it.
- The team **expects** that a shared, governed catalog would reduce duplicate work, produce more consistent asset documentation, and make ownership and maintenance status visible at a glance — but this has not been measured against real usage.
- A future pilot **could measure**: time saved rebuilding vs. reusing an asset, adoption rate across teams, and reviewer time spent on governance checks.

No hours-saved or cost-savings figure is asserted anywhere in this prototype or this README. Business value requires validation in a pilot with real users and real before/after measurement.

---

## Architecture and how it works

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript — server components with focused client islands, one shared design system (no UI framework).
- **Backend/runtime:** Node.js 24, running as one deployable process (a modular monolith, not microservices).
- **Persistence:** Node's built-in `node:sqlite`, one local SQLite database (`data/marketplace.sqlite`), applied through ordered raw-SQL migrations.
- **Contracts:** Canonical Zod schemas in `src/contracts/`, with generated JSON Schema 2020-12 artifacts in `generated/contracts/`, checked for drift in CI.
- **AI/model integration:** An optional, replaceable adapter (configured for Gemini via `AI_PROVIDER`). It is schema-locked, timeout-bounded, retry-limited, and never a startup dependency.
- **Rule-based fallback:** Every AI-touched surface (discovery ranking, the Investigator's inference, contribution-metadata suggestions, and the AI Operator's intent routing) has a deterministic path that runs when `AI_PROVIDER=disabled` (the default).
- **Catalog/fixture source:** Synthetic, event-created fixtures in `fixtures/catalog/`, loaded by the seed scripts in `scripts/db/`.
- **Governance/evidence model:** Database triggers enforce append-only evidence, frozen-content immutability, and evidence bound to the exact content digest it was collected against — see `src/modules/governance/`.
- **Testing:** Vitest, run via `npm test`; contract-drift checks via `npm run contracts:check`.
- **Connectors:** None beyond the optional Gemini adapter; no other third-party or enterprise connector is wired into the running application.

<details>
<summary>Dependency direction</summary>

```text
Next UI / route handlers
          |
          v
operator (natural-language control layer)
          |
          v
catalog | discovery | execution | governance | investigation | insights
          |
          v
shared contracts and narrow ports
          |
          v
one SQLite adapter and ordered migrations
```

The AI Operator sits above the feature modules and owns no persistence of its own; it can only reach the database through a registered, delegated capability. Discovery can read published catalog versions but cannot execute or publish. Execution resolves only a server-owned, allowlisted executor. Governance alone changes lifecycle state and records evidence.

**Path ownership** (for context on how the codebase is organized): contracts, database, and root config live under `src/contracts/`, `db/`, and `scripts/db/`; catalog content and marketplace UX under `src/modules/catalog/`; deterministic discovery under `src/modules/discovery/`; allowlisted execution under `src/modules/execution/`; governance, lifecycle, and evidence under `src/modules/governance/`; the AI Operator layer under `src/modules/operator/`, `src/components/operator/`, and `src/app/control/` and `src/app/agents/`.

**Canonical identity and immutability:** the hero asset is `asset_property_ops_brief`. Immutable asset-version content is stored as canonical JSON; lifecycle, publication/deprecation timestamps, and a server-owned `subject_digest` form a separate governance projection. Once content is frozen, `subject_digest = sha256(canonical JSON({schema_version, version_content, definition_digest}))` with stable key ordering — governance fields and the digest itself are excluded from what's hashed. Publication is lifecycle-only: it never mutates frozen content, and any later content change requires a new version and a new digest, which invalidates earlier publication evidence.

</details>

<details>
<summary>How the AI Operator works (natural-language control layer at <code>/control</code>)</summary>

The loop: `ASK → UNDERSTAND → INVESTIGATE → PLAN → PREVIEW → CONFIRM → ACT → VERIFY → EXPLAIN`. Reads run directly; writes stop at PREVIEW and wait for a human, then the operator re-reads the record and reports what the database actually says — never what the call was supposed to do.

- **AI Control Center** (`/control`) — the full console: command line, live system state, a canvas of records.
- **AI Lens** — the same operator, carrying the current page's context, available in a drawer on every other page.
- **Agent Explorer** (`/agents`) — what each of the five agents that actually run here may decide, and the full capability catalogue with the service behind every tool.

**Routing is deterministic first.** Documented phrasings are matched by rule and never touch the model. The model is consulted only when the deterministic router is unsure, and it may only choose a capability name and name an entity — it cannot query the database or assert a governance fact. Every turn reports which path answered it (`not_needed`, `ready`, `disabled`, or `unavailable`).

**Read vs. write:** read tools execute on request. Write tools have two phases — `run()` builds an action preview (before/after/effects/risk) without changing anything, and `execute()` performs the change only after `POST /api/operator/act` receives an explicit `confirmed: true`, then re-reads and reports the real state. A request the product cannot satisfy (e.g., "archive," which has no lifecycle state here) is reported as unavailable rather than simulated.

**What the model may / may not do:**

| It may | It may not |
| --- | --- |
| Choose one registered capability | Query the database |
| Name the entity a request refers to | Assert a governance fact, score, or gate outcome |
| Write one short interpretation, labelled | Approve, publish, or change lifecycle state |
| Draft contribution metadata for a human to edit | Create anything without an explicit confirmation |

Every model call is schema-locked, timeout-bounded, retry-limited, and falls back to a deterministic path; `AI_PROVIDER=disabled` leaves the whole operator working. Ask it from a terminal with:

```bash
npm run operator:ask -- "why is the Resident Communication Planner flagged?"
npm run operator:ask -- --asset av_resident_comms_1_1_0 "what is blocking publication?"
```

This is the read path only — a state-changing capability prints its action preview and stops, exactly as it does in the UI.

</details>

<details>
<summary>How discovery ranking works (<code>/discovery</code>)</summary>

The discovery API validates the request, applies deterministic guardrails, normalizes intent, detects ambiguity, retrieves only current published/non-deprecated catalog versions, optionally expands query terms through the AI provider boundary, then applies deterministic ranking.

Candidate evidence comes only from canonical catalog fields, weighted: capabilities (0.30), domains (0.24), use cases (0.20), audiences (0.18), input schema terms (0.12), output schema terms (0.12), name/summary/description (0.10). The match threshold is 0.12, and a candidate needs either high-signal field evidence, at least two lexical evidence terms, or at least two semantic terms in high-signal fields. Every returned rationale quotes an actual catalog value and the terms that matched it — internal scores are never returned as a confidence figure.

Optional Gemini enhancement (only when `AI_PROVIDER=gemini` and a key is set) can add at most 20 short query terms to the search — it cannot return asset facts or lifecycle decisions, and every provider failure visibly falls back to deterministic discovery. `DISCOVERY_AI_TIMEOUT_MS` bounds the per-attempt timeout (250–10,000ms, default 4,000ms).

</details>

---

## Trust, governance, and human review

- **Trust score:** A number derived entirely from publication gates the governance layer has actually checked against persisted evidence — never authored or asserted directly.
- **Gates/checks:** Human review, security review, source-permission confirmation, functional validation, guardrail behavior, and reuse evidence each contribute a weighted gate outcome.
- **Missing evidence:** Shown explicitly on the asset detail and Investigator views rather than silently omitted.
- **Stale evidence / version changes:** If content changes after a review, the Investigator compares the digest of the reviewed version against the digest of the currently published content and reports the mismatch and the specific changed fields — this is how *Resident Communication Planner*'s trust drop (100 → 50) is shown in the demo above.
- **Human review required for:** publishing a version, approving a re-review, and any other consequential lifecycle transition. The AI Operator's write capabilities always require an explicit confirmation step and never execute silently.
- **Status vocabulary:**
  - **Verified** — the current content has passed the required governance gates.
  - **Needs attention** — evidence exists but no longer matches the current content, or a gate is unmet.
  - **Not required** — a gate does not apply to this asset type.
  - **Reference only** — a catalog entry with no runnable executor; it can be inspected but not executed.
- **What the prototype does not do:** it does not invent approvals. Reviewer names in this prototype are manually entered demo attestations, not identity-verified organizational sign-off. AI interpretation is rendered in a separate, labeled block and cannot modify a governance fact, a trust score, or a lifecycle state.

---

## Evidence and validation

| Test | Expected behavior | Observed result | Status | Evidence |
| --- | --- | --- | --- | --- |
| Normal discovery/marketplace flow | Search returns ranked, field-explained matches | Confirmed via automated test suite | Tested | `tests/discovery/discovery.test.ts` |
| Hero execution (typical case) | Running the hero produces a real persisted execution | Confirmed | Tested | `tests/investigation/demo-seed.test.ts` |
| Missing/ambiguous input | Hero execution with no observations fails closed, produces no output | Confirmed | Tested | `tests/investigation/demo-seed.test.ts` |
| Guardrail condition | A high-impact request (e.g., "approve or deny an applicant") is redirected to a human, not answered as a match | Confirmed | Tested | `tests/discovery/discovery.test.ts` |
| Reuse across two scenarios | One frozen hero version, two distinct persisted executions with different scenario labels | Confirmed | Tested | `tests/investigation/demo-seed.test.ts` |
| Investigation / trust drift | Trust 100 → 50 reported correctly with field-level diff for `av_resident_comms_1_1_0` | Confirmed | Tested | `tests/investigation/investigation.test.ts` |
| AI-unavailable fallback | Discovery and Investigator both work and visibly label the deterministic path when `AI_PROVIDER=disabled` | Confirmed | Tested | `tests/discovery/discovery.test.ts`, `tests/investigation/investigation.test.ts` |
| Full verification gate | Typecheck, contract-drift check, full test suite, and production build all succeed together | Confirmed in this session: **266 tests passed across 33 files (2 live-network suites skipped)** | Tested | `npm run verify`, run 2026-09-17 |
| Reviewer access / fresh-install check | A non-owner reviewer can clone, install, and run the demo path unaided | `[TODO: Record a fresh-install check by a teammate who did not build the feature]` | Planned | — |
| Measured time savings | Before/after timing of the hero workflow vs. the manual task | Not yet run | Planned | `00_Admin/STATUS.md` records this as an open, not-started item |

---

## Getting started

### Prerequisites

- Node.js `24.21.0` (see [`.nvmrc`](.nvmrc)) — Node 24's built-in `node:sqlite` is required.
- npm `11.19.0` (`package-lock.json` is the only lockfile).
- No AI key, cloud account, Docker service, or SQLite CLI is required. Optional AI is strictly additive; the product is fully usable without it.

On Windows PowerShell installations that block `npm.ps1`, use `npm.cmd` in place of `npm`.

```bash
# Install
npm ci

# Configure (optional — the app runs with no .env at all)
cp .env.example .env

# Set up demo data
npm run db:reset

# Run
npm run dev

# Test
npm test

# Full verification gate (typecheck + contracts + tests + build)
npm run verify
```

Then open <http://localhost:3000>.

- **Production build:** `npm run build` (this genuinely exists and is exercised by CI; `npm start` serves it).
- **Required accounts/licenses:** none, for the default deterministic experience. Optional AI requires a Gemini API key set as `GEMINI_API_KEY` with `AI_PROVIDER=gemini`; this is never required to run or demo the product.
- **Offline/fallback behavior:** with `AI_PROVIDER=disabled` (the `.env.example` default), every AI-touched surface runs its deterministic fallback and the product is fully functional.

---

## Repository structure

```
AI_marketplace/
├── src/
│   ├── app/             # Next.js routes: marketplace, discovery, assets, control, agents, governance, compare, drift, contribute, api/
│   ├── modules/         # catalog, discovery, execution, governance, investigation, insights, operator
│   ├── contracts/       # Canonical Zod schemas (source of truth for validation)
│   └── shared/          # Ports: clock, ID, optional-AI, executor lookup
├── db/                  # SQL migrations
├── scripts/db/          # migrate / seed / reset CLIs
├── fixtures/catalog/    # Synthetic demo catalog data
├── generated/contracts/ # Generated JSON Schema 2020-12 artifacts (CI-checked against contracts)
├── tests/               # Vitest suites: contracts, database, discovery, execution, governance, insights, integration, integrity, investigation, operator, frontend
├── docs/                # evaluation/, reports/, requests/ (supporting evidence and evaluation datasets)
├── 00_Admin/            # STATUS.md, HANDOFF.md, DECISIONS.md, TEAM_CHARTER.md (event coordination records)
├── 01_Sponsor_Inputs/   # Official sponsor brief
├── 03_Final_Submission/ # Official submission templates
└── README.md            # This file
```

---

## Data, sources, and permissions

| Source | How it was used | Access / tool-use / final-package permission |
| --- | --- | --- |
| `01_Sponsor_Inputs/05_Realpage AI Marketplace Brief.pdf` (sponsor-provided) | Authoritative assigned requirements | Confirmed for local event use; final-package redistribution permission is unconfirmed — do not redistribute externally |
| Official coordination templates in `00_Admin/` and `03_Final_Submission/` (sponsor-provided) | Required event coordination and submission structure | Confirmed for local event use; shared-workspace placement still unverified |
| Bootstrap catalog fixtures and metadata (created during event, synthetic) | Contract, persistence, and demo fixtures | Permission fields remain `unconfirmed` pending a real creator attestation — no customer or production data is used |

- **Synthetic demonstration data:** the entire catalog (assets, versions, evidence, executions, lifecycle events) is synthetic content created during the event. No customer or production data is used anywhere.
- **Team-created code and content:** all application code, contracts, tests, docs, and fixtures were created by the team during the event.
- **Reused libraries:** Next.js, React, Zod, Ajv, TypeScript, Vitest, tsx — standard open-source dependencies declared in [`package.json`](package.json); no third-party template or boilerplate was used as a starting point.
- **AI tools/models actually used:** an optional Gemini adapter, disabled by default; no other model or AI tool is wired into the running application.
- **Connectors:** none beyond the optional Gemini adapter described above.
- **Secrets:** `.env` and all local SQLite database files are excluded from version control via [`.gitignore`](.gitignore); no credential or key is present in this repository.

---

## Limitations

- This is a hackathon prototype, not a production system.
- All catalog data is synthetic; no customer or production data is used.
- Authentication is not implemented. Reviewer and contributor names are entered manually and recorded as demo attestations, not identity-verified organizational approvals.
- There is no production or hosted database — the app runs against a single local SQLite file.
- Some catalog assets are `reference_only`: they can be inspected in full but are not runnable, and are never presented as executable.
- External AI model availability may vary; every AI-touched surface has a deterministic fallback and the product does not depend on the model being reachable.
- The prototype does not make or automate customer, employee, employment, compensation, performance, legal, or production decisions. Every consequential action requires human confirmation.
- A formal production security review is outside this prototype's scope.
- Business value (time saved, adoption, reuse rate) has not been validated with a production pilot or real users.
- No approvals — sponsor, security, or organizational — are claimed for this prototype beyond what is documented above.

---

## Challenges and decisions

- **Keeping governance facts deterministic:** trust scores and gate outcomes are computed only from persisted evidence, never asserted by a model, so a judge or reviewer can trace every number back to a database row.
- **AI as an explanatory layer, not an approval mechanism:** the Investigator and AI Operator can interpret and suggest, but every write requires an explicit human confirmation and calls the same governance API a human reviewer would use.
- **A rule-based fallback everywhere AI touches the product:** discovery ranking, investigation inference, contribution suggestions, and operator routing all have a deterministic path, so the demo never depends on model availability.
- **Synthetic data over real data:** the team used event-created fixtures rather than any customer or production data, trading some demo realism for a clean permissions story.
- **Separating reference-only assets from runnable ones:** most of the catalog is intentionally reference-only, so the one hero asset that is genuinely runnable end-to-end could be built to a higher standard of evidence rather than shipping many shallow "runnable" assets.
- **A focused, reviewable prototype over production complexity:** one modular monolith, one SQLite database, one lockfile — deliberately chosen (see [`00_Admin/DECISIONS.md`](00_Admin/DECISIONS.md)) over a distributed or multi-service architecture, to keep the whole system reviewable in the judging window.

---

## Team

- Saggidi Kushal
- Kelly Goldsborough
- Gavidi Suhita
- Supriya Janjirala
- Loven Ybanez

**Team / channel ID:** Q3 AI Hackathon-IAM-03

`[TODO: Confirm individual role/workstream assignments — not documented in the repository; 00_Admin/TEAM_CHARTER.md's roster table is currently blank]`

---

## Ownership, version, and reviewer access

| Field | Value |
| --- | --- |
| Artifact owner | `[TODO: Assign an accountable maintainer — 00_Admin/TEAM_CHARTER.md lists this as unassigned]` |
| Final artifact version | Application `0.1.0` · contract manifest `1.0.0` · migration `001_initial` · hero asset version `1.0.0` |
| Completion timestamp (PT) | `[TODO: Record final completion timestamp before the 11:59 PM PT, September 17, 2026 submission cutoff]` |
| Reviewer access checker | `[TODO: Name the teammate who verifies a non-owner can clone and run this repository]` |
| Access-check timestamp (PT) | `[TODO: Record once the reviewer access check above is performed]` |
| Required work account, role, or license | None required for the default (AI-disabled) experience. `npm`/Node.js only. |
| Location of final artifact | This repository, `AI_marketplace/` (root); this file at `AI_marketplace/README.md` |
| Demo video / screenshot fallback | `[TODO: No screenshots or backup video were found in this repository at the time of writing — add one if a reviewer may not be able to run the app live]` |

---

## What is next

1. Validate the experience with a small internal user group.
2. Confirm marketplace ownership and publishing responsibilities.
3. Integrate approved authentication and persistent storage.
4. Formalize security, permissions, and review workflows.
5. Replace synthetic records with permissioned real contributions.
6. Measure adoption, reuse, time saved, and review quality.

No production deployment is planned or promised as part of this prototype.

---

## Related submission materials

- Demo steps: `[TODO: Add final DEMO_STEPS.md link]` — none exists in this repository; see [Demo journey](#demo-journey) above.
- Test evidence: [`00_Admin/STATUS.md`](00_Admin/STATUS.md) (test/evidence log)
- Final handoff: [`00_Admin/HANDOFF.md`](00_Admin/HANDOFF.md)
- Screenshots: `[TODO: none found in this repository]`
- Backup video: `[TODO: none found in this repository]`
- Final submission checklist: [`03_Final_Submission/FINAL_SUBMISSION_CHECKLIST.md`](03_Final_Submission/FINAL_SUBMISSION_CHECKLIST.md)

---

## Contact and support

Use-case contacts:

- Austin Braham — [Austin.braham@realpage.com](mailto:Austin.braham@realpage.com)
- Kim Bowen — [Kim.Bowen@RealPage.com](mailto:Kim.Bowen@RealPage.com)
- William Allan — [William.Allan@RealPage.com](mailto:William.Allan@RealPage.com)
- Erin Connolly — [erin.connolly@RealPage.com](mailto:erin.connolly@RealPage.com)
- Tom Millard — [tom.millard@Realpage.com](mailto:tom.millard@Realpage.com)

Report any submission-location or reviewer-access issue to **Austin.braham@realpage.com**.

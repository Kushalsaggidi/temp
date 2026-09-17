# Sources and Permissions — RealPage AI Marketplace

Companion to [README.md](README.md). See also [DEMO_STEPS.md](DEMO_STEPS.md) and [HANDOFF.md](HANDOFF.md).

## 1. Document information

| Field | Value |
| --- | --- |
| Project | RealPage AI Marketplace |
| Team / channel | Q3 AI Hackathon-IAM-03 |
| Artifact version | Application `0.1.0` · contract manifest `1.0.0` · migration `001_initial` · hero asset version `1.0.0` |
| Last updated (PT) | `[TODO: Record the PT timestamp when this document is finalized]` |
| Purpose | An honest inventory of every source, dataset, dependency, AI tool, and permission question behind this prototype, so a reviewer can judge what is safe to run, show, and submit. |

## 2. Executive summary

- The project is primarily team-created code: all application code, contracts, tests, and documentation in `src/`, `tests/`, `scripts/`, and this repository's root-level markdown files were written by the team during the event. Verified by direct inspection of the source tree and `package.json`.
- All catalog and governance data (assets, versions, evidence records, executions, lifecycle events) is synthetic, created for the event. No customer or production data is used anywhere. Verified by reading `fixtures/catalog/published-catalog.ts` and `fixtures/contracts/README.md`, which states these examples are not real persisted evidence.
- One sponsor-provided material is included: `01_Sponsor_Inputs/05_Realpage AI Marketplace Brief.pdf`. Its final-package redistribution permission is unconfirmed.
- One external AI service is integrated: Google Gemini, called via a hand-rolled HTTP `fetch` (no vendor SDK dependency). It is optional, disabled by default (`AI_PROVIDER=disabled`), and never required to run, build, or test the application. Verified by reading `src/modules/discovery/adapter.ts`, `.env.example`, and `package.json` (no `@anthropic-ai/*` or `openai` dependency exists).
- No customer data, employee-level data, or production data is included anywhere in this repository. Verified by inspection of `fixtures/`, `data/`, and `db/`.
- Open permission questions remain: sponsor-brief redistribution, catalog-fixture "creator permission" attestations, and shared-workspace (Teams/SharePoint) placement of the official coordination templates. See Section 10.

## 3. Complete source inventory

| Source or asset | Category | Owner/provider | How it is used | Access allowed? | Tool use allowed? | Final-package inclusion allowed? | Evidence/reference | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Application source (`src/`, `scripts/`, `tests/`) | Team-created code | Team | The application itself | Yes | Yes | Yes | Direct file inspection | Confirmed |
| Catalog fixtures (`fixtures/catalog/`) | Synthetic data | Team (event-created) | Seeds the demo database | Yes | Yes | Yes | `fixtures/contracts/README.md`; `scripts/db/seed.ts` | Confirmed |
| Contract schemas (`src/contracts/`, `generated/contracts/`) | Team-created code | Team | Validation source of truth | Yes | Yes | Yes | Direct file inspection | Confirmed |
| Documentation (`README.md`, this file, `DEMO_STEPS.md`, `HANDOFF.md`, `00_Admin/*`) | Team-created content | Team | Judge/reviewer-facing and internal handoff docs | Yes | Yes | Yes | Direct file inspection | Confirmed |
| `01_Sponsor_Inputs/05_Realpage AI Marketplace Brief.pdf` | Sponsor-provided material | RealPage event sponsors | Source of assigned requirements | Confirmed for local event use | Confirmed for local event use | Needs confirmation (redistribution permission unconfirmed) | README.md § Data, sources, and permissions | Needs confirmation |
| Official coordination templates (`00_Admin/`, `03_Final_Submission/`) | Sponsor-provided material | RealPage event organizers | Required event coordination and submission structure | Confirmed for local event use | Confirmed for local event use | Needs confirmation (shared-workspace placement unverified) | README.md § Data, sources, and permissions | Needs confirmation |
| Next.js, React, TypeScript, Zod, Ajv, Vitest, tsx | Open-source dependency | Respective open-source maintainers | Application framework, validation, and test tooling | Yes | Yes | Yes (via `package.json` / `package-lock.json`, no vendored source) | [`package.json`](package.json), [`package-lock.json`](package-lock.json) | Confirmed |
| Google Gemini API | AI model/service | Google | Optional discovery-term expansion, investigation inference, and contribution-metadata suggestion | Needs confirmation (requires a `GEMINI_API_KEY` the team holds; enterprise approval for this specific external call is not documented) | Needs confirmation | Not applicable (no model weights, only an API call; the adapter code itself is team-created and includable) | `src/modules/discovery/adapter.ts`; `.env.example` | Needs confirmation |
| `.env` (local, gitignored) | Not applicable | Team (local only) | Local runtime configuration, may contain a real API key | Not applicable — excluded from the repository | Not applicable | Not included (excluded by `.gitignore`) | [`.gitignore`](.gitignore) | Not included |
| Local SQLite database files (`data/*.sqlite*`) | Test fixture | Team (generated locally) | Local demo persistence | Yes, locally | Yes, locally | Not included (excluded by `.gitignore`; regenerated via `npm run db:reset`) | [`.gitignore`](.gitignore) | Not applicable |

## 4. Created during the hackathon

The following were verified as team-created by direct inspection:

- **Application code:** the full Next.js application under `src/app/`, `src/components/`, `src/modules/`, `src/contracts/`.
- **Marketplace UX:** overview, marketplace browsing, discovery, asset detail, governance, investigation, contribution, and AI Operator (`/control`, `/agents`) pages.
- **Catalog fixtures:** the synthetic catalog in `fixtures/catalog/published-catalog.ts` and `fixtures/catalog/bootstrap-draft.json`.
- **Discovery logic:** deterministic ranking and guardrails in `src/modules/discovery/`.
- **Governance presentation and trust-score behavior:** `src/modules/governance/`.
- **Investigation experience:** `src/modules/investigation/`.
- **Demo scenarios:** the two persisted hero-asset executions and the Resident Communication Planner trust-drift scenario, both seeded via `scripts/db/seed.ts`.
- **Documentation:** `README.md`, this document, `DEMO_STEPS.md`, `HANDOFF.md`, and the internal records in `00_Admin/`.
- **Tests:** 35 Vitest suites under `tests/`, independently re-run during preparation of this document (`npm test`: 266 passed, 2 skipped across 33 files).

## 5. Reused material

| Reused item | Owner/provider | Why used | What the team created/modified | License/permission | Attribution required? |
| --- | --- | --- | --- | --- | --- |
| Next.js, React, React DOM | Vercel / Meta (open source) | Application framework | Team wrote all application code on top of the framework; no starter template used | Open-source (see respective package licenses in `node_modules`/npm registry) | Standard OSS notice only; no additional attribution added to this repository |
| TypeScript, Vitest, tsx, Zod, Ajv | Respective open-source maintainers | Type-checking, testing, schema validation, script execution | Team wrote all schemas, tests, and scripts | Open-source | Standard OSS notice only |
| No icons, fonts, images, or AI-generated visual assets were found in this repository | Not applicable | Not applicable | Not applicable | Not applicable | Not applicable |

Full dependency list: [`package.json`](package.json) and [`package-lock.json`](package-lock.json). No dependency list is duplicated here.

No design system, UI component library, or third-party template was used as a starting point — verified by inspection of `src/components/` and `next.config.ts`.

## 6. AI tools, models, APIs, and connectors

| Tool/model/connector | Development or runtime use | Purpose | Data sent | Output used | Human review | Permission status |
| --- | --- | --- | --- | --- | --- | --- |
| Google Gemini (`gemini-3.5-flash-lite`, called via raw HTTP `fetch`, no SDK) | Optional runtime integration | Discovery query-term expansion (up to 20 extra search terms); investigation-inference commentary (labeled "not verified"); contribution-metadata draft suggestions | The user's discovery query text or contribution draft fields; schema-locked, timeout-bounded (`DISCOVERY_AI_TIMEOUT_MS`, default 4000ms), retry-limited (2 attempts) | Only as additional search terms or a labeled, non-authoritative suggestion — never as an asset fact, trust score, or governance decision | Always — every write action (publish, approval, lifecycle change) requires an explicit human confirmation regardless of AI output | Needs confirmation — no enterprise data-sharing approval for sending query text to the Gemini API is documented in this repository |
| Rule-based/deterministic discovery ranking | Runtime integration (default, always on) | Primary discovery matching against canonical catalog fields | Catalog data only (no external call) | Directly, as the ranked result set | Not applicable — deterministic logic, no AI involved | Confirmed — no external data leaves the application |
| AI code-generation tools used during development | Development assistance | `[TODO: Confirm which, if any, AI coding assistants were used during development — not recorded in this repository. 00_Admin/STATUS.md notes a possible mismatch between the AI provider used at runtime (Gemini) and tools the event rules may have expected (e.g., Copilot/RPGPT/ChatGPT-Codex/Claude); confirm event tool-compliance before submission.]` | `[TODO]` | `[TODO]` | `[TODO]` | Needs confirmation |
| Any other connector (Slack, Salesforce, SharePoint, etc.) | Future integration (not present) | Not implemented in this prototype | Not applicable | Not applicable | Not applicable | Not applicable |

## 7. Data classification and boundaries

| Data type | Included? | Purpose | Boundary or protection |
| --- | --- | --- | --- |
| Synthetic demonstration data | Yes | Populates the entire catalog, governance evidence, and execution history | Created during the event; stored only in the local SQLite file, excluded from version control by `.gitignore` |
| Team-created data (documentation, decisions, status logs) | Yes | Project records | Stored as plain markdown in the repository |
| Sponsor-provided data (the sponsor brief PDF) | Yes | Assigned requirements | Redistribution permission for the final package is unconfirmed (see Section 10) |
| Customer data | No | Not applicable | Not present anywhere in the repository — confirmed by inspection of `fixtures/`, `data/`, `db/` |
| Employee-level data | No | Not applicable | Not present |
| Production data | No | Not applicable | Not present; the application only ever runs against a local SQLite file |
| Credentials and secrets | No | Not applicable | `.env` is excluded from version control by `.gitignore`; `.env.example` contains no real values; this document deliberately does not quote or reference the contents of any local `.env` file |
| Reviewer and approval records | Yes, but synthetic | Demonstrates the governance/trust model | Every reviewer name and evidence record in the seeded catalog (e.g., the human-review attestation on Capital Project Intake Template) is a demonstration fixture, not a real organizational approval or identity-verified sign-off |

**Synthetic reviewers, evidence, and governance records in this prototype are demonstration fixtures. They are not real organizational approvals, and no individual named in a fixture record has actually reviewed or approved anything in production.**

## 8. Safety and human-review boundaries

This prototype must not, and does not, do any of the following:

- Make customer decisions.
- Make employee, employment, compensation, or performance decisions.
- Make legal decisions.
- Make production decisions or external production changes.
- Treat AI output as organizational approval.
- Treat synthetic evidence as real attestation.
- Expose restricted information or credentials.

Human review remains required for: publishing an asset version, approving a re-review, flagging an asset for re-review, and any other consequential lifecycle transition. The AI Operator's write capabilities always stop at a preview step and require an explicit `confirmed: true` before any change is made (`src/app/api/operator/act/route.ts`).

## 9. Final-package safety checklist

```text
[ ] No API keys included
[ ] No passwords included
[ ] No access tokens included
[ ] No private certificates included
[ ] No live customer data included
[ ] No sensitive employee data included
[ ] Synthetic data is labeled
[ ] Reused assets are attributed
[ ] Environment files contain placeholders only
[ ] Final links follow approved access boundaries
```

Verification performed for this document:
- `.env` exists locally but was not read and is excluded by `.gitignore` — not included in the repository. `.env.example` contains only placeholder values (confirmed by direct inspection).
- No hard-coded API keys, passwords, tokens, or certificates were found anywhere in `src/`, `scripts/`, or `tests/` (confirmed by targeted search for provider names and secret-shaped strings).
- No customer or employee data exists anywhere in the repository (confirmed by inspection of all data-bearing directories).
- Synthetic data is labeled as such throughout `README.md`, this document, and `fixtures/contracts/README.md`.

`[TODO: Mark each checklist line above complete only after a final pre-submission pass by a teammate other than the one who wrote this document, per the Final Submission Checklist in 03_Final_Submission/FINAL_SUBMISSION_CHECKLIST.md.]`

## 10. Open permission questions

| Question | Why it matters | Owner to confirm | Safe fallback |
| --- | --- | --- | --- |
| Can the sponsor brief PDF (`01_Sponsor_Inputs/05_Realpage AI Marketplace Brief.pdf`) be included/redistributed in the final submission package? | It is sponsor-provided material; redistribution permission is currently unconfirmed | `[TODO: Confirm with event support — e.g., Austin Braham]` | Exclude the PDF from any externally shared package; reference it by filename only |
| Is sending discovery query text and contribution-draft text to the Google Gemini API an approved use of an external AI service for this event/data classification? | No enterprise data-sharing approval for this specific external call is documented | `[TODO: Confirm with event support or a data-governance contact]` | Keep `AI_PROVIDER=disabled` for any demo or submission where this has not been confirmed — the product is fully functional without it |
| Does the Gemini-based AI integration meet the event's expected/approved tool list? | `00_Admin/STATUS.md` notes the event rules may reference other tools (e.g., Copilot/RPGPT/ChatGPT-Codex/Claude) and flags this as a possible judge concern | `[TODO: Confirm with event organizers]` | Disclose the actual provider used (Gemini) transparently rather than imply a different one |
| Are the official coordination templates in `00_Admin/` and `03_Final_Submission/` placed in the correct shared workspace (Teams/SharePoint) as required for submission? | `03_Final_Submission/README.md` and `FINAL_SUBMISSION_CHECKLIST.md` are currently blank, unfilled templates | `[TODO: Confirm with team coordinator — not assigned in this repository]` | Complete the official templates in `03_Final_Submission/` before the submission deadline (11:59 PM PT, Thursday, September 17, 2026, per the checklist) |
| Do the synthetic reviewer names in catalog evidence records need any disclaimer beyond what is already in README.md and this document? | Reviewer names (e.g., "Tomas Berg" on Capital Project Intake Template) could be mistaken for real approvals | `[TODO: Confirm with event support if judges raise this]` | Keep the existing explicit disclosure that these are demonstration fixtures, not real attestations |

## 11. Contacts

- Austin Braham — [Austin.braham@realpage.com](mailto:Austin.braham@realpage.com) — first point of contact for submission-location or reviewer-access issues.
- Kim Bowen — [Kim.Bowen@RealPage.com](mailto:Kim.Bowen@RealPage.com)
- William Allan — [William.Allan@RealPage.com](mailto:William.Allan@RealPage.com)
- Erin Connolly — [erin.connolly@RealPage.com](mailto:erin.connolly@RealPage.com)
- Tom Millard — [tom.millard@Realpage.com](mailto:tom.millard@Realpage.com)

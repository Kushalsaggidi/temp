# Demo Steps — RealPage AI Marketplace

Companion to [README.md](README.md). See also [SOURCES_AND_PERMISSIONS.md](SOURCES_AND_PERMISSIONS.md) and [HANDOFF.md](HANDOFF.md).

This guide is written for a teammate who did not build the application. Follow it in order; it does not assume prior familiarity with the codebase.

---

## 1. Demo information

| Field | Value |
| --- | --- |
| Project | RealPage AI Marketplace |
| Team / channel ID | Q3 AI Hackathon-IAM-03 |
| Artifact version | Application `0.1.0` · contract manifest `1.0.0` · migration `001_initial` · hero asset version `1.0.0` |
| Expected duration | 4–6 minutes (primary path) |
| Presenter | `[TODO: Confirm who is presenting — not documented in the repository]` |
| Required account, role, or license | None for the default (AI-disabled) experience. Node.js and npm only. |
| Local URL | `http://localhost:3000` |
| Primary demo mode | Live application, `AI_PROVIDER=disabled` (the `.env.example` default) — deterministic discovery and governance, no dependency on a live external AI service |
| Backup demo mode | `[TODO: No screenshots or backup video exist in this repository as of this writing — see Section 8]` |

---

## 2. Pre-demo setup

Run these from the repository root. All commands are taken directly from `package.json` and the root [README.md](README.md#getting-started).

1. **Clone or download the final artifact** and confirm you are in the correct directory (`AI_marketplace/`).
2. **Confirm the correct version or commit.**
   `[TODO: This repository has no commit history at the time of writing (git status shows all tracked files as untracked). Confirm the actual submission commit/tag once one exists.]`
3. **Install prerequisites.**
   - Node.js `24.21.0` (see [`.nvmrc`](.nvmrc)) — required because the app uses Node's built-in `node:sqlite`.
   - npm `11.19.0` (the version pinned in `package.json`'s `packageManager` field).
   - On Windows PowerShell installations that block `npm.ps1`, use `npm.cmd` in place of `npm`.
4. **Install dependencies:**
   ```bash
   npm ci
   ```
5. **Create environment configuration from the safe example:**
   ```bash
   cp .env.example .env
   ```
   Leave `AI_PROVIDER=disabled` (the default) for the primary demo path. Do not display the contents of any real `.env` file on screen — `.env.example` contains no secret and is safe to show; a filled-in `.env` may contain a real API key and must never be shown.
6. **Load synthetic demo data:**
   ```bash
   npm run db:reset
   ```
   This wipes and recreates the local SQLite file (`data/marketplace.sqlite`), applies the one migration, and seeds the synthetic catalog.
7. **Start the application:**
   ```bash
   npm run dev
   ```
8. **Confirm the local URL:** open `http://localhost:3000`.
9. **Run the required health/test command:**
   ```bash
   npm test
   ```
   Expected result, reproduced independently during preparation of this document: **266 tests passed across 33 files (2 live-network suites skipped)**. If your run differs, do not proceed to present without investigating.
10. **Reset the demo state** (repeat before every rehearsal or live run so trust-score history is clean):
    ```bash
    npm run db:reset
    ```

### Readiness checklist

```text
[ ] Correct artifact version confirmed
[ ] Dependencies installed
[ ] Application starts
[ ] Overview loads
[ ] Marketplace loads
[ ] Discovery returns the expected results
[ ] Asset details load
[ ] Governance page loads
[ ] Investigation flow opens
[ ] AI-unavailable fallback works
[ ] Backup video or screenshots open
[ ] No credentials are visible
```

`[TODO: No backup video or screenshots currently exist — see Section 8. That checklist item cannot be marked complete until backup material is created.]`

---

## 3. Opening script (20–30 seconds)

> "Across RealPage, people build genuinely useful AI assets — templates, checklists, small agents — but that work stays stuck in personal files or one team's folder. Nobody else can easily tell what already exists, whether it's trustworthy, or who owns it, so people end up rebuilding things that already exist. This prototype is a governed internal marketplace: it helps people find an asset, verify whether it's actually ready to use, and reuse it — while keeping governance and human review visible the whole time. The tagline is 'Find. Verify. Reuse.'"

---

## 4. Main demonstration

All actions below are confirmed to work against the seeded catalog as of this writing (`npm test`: 266 passed, 2 skipped). The two discovery scenarios below use queries taken directly from the project's own discovery evaluation set (`docs/evaluation/discovery-set-v2.json`), not invented text.

| Time | Presenter action | Expected result | What to say | What this proves |
| --- | --- | --- | --- | --- |
| 0:00–0:30 | Open `http://localhost:3000` (Overview) | Homepage shows catalog health: published, verified, runnable, and needs-attention counts | "This is the marketplace overview — it shows how many assets exist and how many are actually ready to use, not just published." | The marketplace addresses a real internal problem and gives an at-a-glance trust picture. |
| 0:30–1:15 | Navigate to `/marketplace`, open **Property Operations Brief Builder** | Asset detail page loads: purpose, audience, capabilities, common uses, inputs, outputs, limitations, owner, version, trust/governance status, human-review requirement | "This is the one asset that went through the full real publication path. Finding it doesn't mean it's automatically approved for use — you can see exactly which governance checks it passed." | Users can find and fully understand a reusable asset before trusting it; trust status comes from persisted checks, not a label. |
| 1:15–2:15 | Go to `/discovery`, search: **"prepare a property operations review"** | Returns **Turnover Readiness Checklist** as the top match, with the matched fields shown | "I described a need in plain language. The system explains *why* each result matched — it's not a black box." | Natural-language discovery works against real catalog fields, with an explainable rationale. |
| 2:15–3:15 | In `/discovery`, search: **"help with tenant updates"** | Returns **Resident Communication Planner** as the top match | "Same discovery workflow, completely different domain — property operations versus resident communications. I didn't rebuild anything to support this second use case." | The same core marketplace supports two different scenarios without rebuilding the system. |
| 3:15–4:15 | Open `/governance`, then the Investigate action on **Resident Communication Planner** | Investigator shows trust dropping from 100 to 50, explains that human/security review was recorded against content version `1.0.0` but the currently published content is `1.1.0`, lists the changed fields, and recommends flagging for re-review | "This asset's trust score dropped because the reviewed content and the published content no longer match. The AI here only explains what the database already shows — it labels its own interpretation as unverified. A human still has to act on the recommendation." | Governance status comes from persisted records and evidence; AI can explain but not create an approval; human review remains required. |
| 4:15–5:00 | Open `/assets/av_property_ops_brief_1_0_0/try`, show the run history with two persisted executions (property-operations scenario and energy/utility scenario) | Two distinct execution IDs against the same frozen asset version and executor | "Same frozen asset, same code, two materially different inputs, two real persisted runs — that's the reuse proof, read from the database, not re-generated for this demo." | The same core asset supports genuine reuse across scenarios, backed by real records. |
| 5:00–5:45 | Open `.env` (or explain verbally) that `AI_PROVIDER=disabled` is the default, then repeat the `/discovery` search from step 2 if time allows | Discovery still returns correct ranked results with no external AI call | "AI enhancement here is optional — it can add search terms, but the ranking is deterministic. If the AI service is unavailable, standard matching keeps discovery working exactly like this." | The application has a safe, working fallback when the external AI service is unavailable. |

If time runs short, cut the final fallback step and state the fallback behavior verbally instead — it is already true throughout the demo, since the primary path runs with `AI_PROVIDER=disabled`.

---

## 5. Closing script (20–30 seconds)

> "What you just saw is a working example of finding, verifying, and reusing an AI asset — across two different scenarios — with governance facts that come from real records, not from the AI itself. A human is always in the loop for anything consequential. This is a hackathon prototype, not a production system, but it proves the core pattern: a governed catalog can make reuse easier and keep trust visible at the same time. The responsible next step is a small internal pilot before any production investment."

---

## 6. Likely judge questions

| Question | Answer |
| --- | --- |
| Is this production-ready? | No. It is a hackathon prototype: no authentication, a single local SQLite database, no production security review, and no validated business-value measurement. See [README.md § Limitations](README.md#limitations). |
| Does every asset execute? | No. Only the hero asset (Property Operations Brief Builder) is runnable end-to-end. Most catalog entries, including Capital Project Intake Template, are `reference_only` — inspectable but not executable, and never presented as executable. |
| What does the trust score mean? | It is a number computed from weighted governance gates (human review, security review, source-permission confirmation, functional validation, guardrail behavior, reuse evidence) checked against persisted evidence for that specific asset version. It is not a universal guarantee and does not carry forward automatically to a new content version. |
| Can AI approve an asset? | No. AI can explain, interpret, and suggest (e.g., draft contribution metadata, or explain a trust drop), but every governance fact, trust score, and lifecycle change is computed or executed deterministically, and every consequential action requires an explicit human confirmation. |
| What happens when the model is unavailable? | Every AI-touched surface (discovery, the Investigator, contribution-metadata suggestions, the AI Operator) has a deterministic fallback. With `AI_PROVIDER=disabled` (the default) or if the Gemini API is unreachable, the product keeps working using rule-based logic. |
| Is the data real? | No. The entire catalog (assets, versions, evidence, executions, lifecycle events) is synthetic data created during the event. No customer or production data is used anywhere. |
| How does this reduce duplicate work? | By making it possible to search for an existing asset in plain language, see what it does and whether it's trustworthy, and reuse it directly — instead of rebuilding it. This is the team's expectation, not a measured result; no time-savings figure has been validated. |
| What is the second reuse scenario? | The discovery query "help with tenant updates," which returns the Resident Communication Planner — a different domain (resident communications) than the property-operations scenario, using the same discovery workflow with no code change. |
| What is required before production? | Approved authentication and access control, persistent production-grade storage, a formal security and permissions review, replacing synthetic records with real permissioned contributions, and a validated pilot. See [README.md § What is next](README.md#what-is-next). |
| Who maintains marketplace assets? | `[TODO: No individual asset-maintenance ownership is documented in this repository. 00_Admin/TEAM_CHARTER.md's roles table is blank.]` |

---

## 7. Failure recovery

| Problem | Immediate response | Backup |
| --- | --- | --- |
| Application does not start | Check the terminal for the exact error; confirm Node `24.21.0` is active (`node -v`) and `npm ci` completed without error | `[TODO: No backup video/screenshots exist — see Section 8]` |
| Installation fails (`npm ci` error) | Confirm `package-lock.json` is present and untouched; retry with a clean `node_modules` removal only if the presenter is comfortable doing so | `[TODO: same as above]` |
| Port is occupied (3000 in use) | Stop the conflicting process, or run `next dev -p <port>` and adjust the local URL announced to the audience | `[TODO: same as above]` |
| External model (Gemini) is unavailable | No action needed — the app is designed to run with `AI_PROVIDER=disabled` for the primary demo; if it was enabled and fails, every consuming surface falls back automatically and stays usable | Narrate the fallback verbally per Section 4, step 6 |
| Discovery produces an unexpected result | Re-run `npm run db:reset` to restore the known seeded state, then repeat the exact queries from Section 4 | `[TODO: same as above]` |
| Internet access fails | The primary demo does not require internet access (SQLite is local, `AI_PROVIDER=disabled` makes no external calls) — continue the demo as planned | Not applicable for the primary path |
| External link cannot be opened | Avoid opening any external link during the live demo; all primary-path steps are local (`localhost:3000`) | `[TODO: same as above]` |
| Presenter loses the session | Restart with `npm run dev`; data persists in the local SQLite file unless `db:reset` was run | `[TODO: same as above]` |

---

## 8. Backup walkthrough

`[TODO: No screenshots or video exist anywhere in this repository as of this writing — confirmed by a full-repository search for image/video file types. This is also disclosed in README.md's "Related submission materials" section. Backup material should be created (e.g., a screen recording of the primary path in Section 4) before the actual submission/judging session, in case live access fails.]`

Once backup material exists, this section should specify:
1. The exact relative path to the screenshots or video.
2. The order in which to show them, matching the Main Demonstration table in Section 4.

---

## 9. Presenter checklist

```text
[ ] Fresh installation tested
[ ] Final version confirmed
[ ] Demo inputs tested
[ ] Demo completed within six minutes
[ ] AI fallback tested
[ ] Backup materials tested
[ ] Every link opened
[ ] No secrets visible
```

`[TODO: "Backup materials tested" cannot be completed until backup material in Section 8 is created.]`

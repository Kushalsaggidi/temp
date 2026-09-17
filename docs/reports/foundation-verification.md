# Agent 01 foundation verification

Verified on 2026-09-16 in the local hackathon workspace. Times below are Pacific Time unless stated otherwise. This is a supporting technical report; `00_Admin/STATUS.md` remains the canonical progress and evidence index.

## Environment reproduced

| Item | Observed value |
| --- | --- |
| Operating environment | Windows / PowerShell |
| Node.js | `v24.21.0` |
| npm | `11.19.0` |
| SQLite | `3.53.4` through Node's built-in `node:sqlite` |
| Package lockfiles | One: root `package-lock.json` |
| Optional AI credential | Not set or required |

## Verified commands

| Check | Command | Observed result |
| --- | --- | --- |
| Clean install | `npm ci` | Passed from the root lockfile: 65 packages installed, 66 audited, 0 reported vulnerabilities. |
| Deterministic reset | `npm run db:reset` | Passed; recreated `data/marketplace.sqlite`, applied migration `001_initial`, and seeded the canonical draft. |
| Migration idempotence | `npm run db:migrate` after reset | Passed; reported database already up to date. |
| Seed idempotence | `npm run db:seed` after reset | Passed; canonical version remained `av_property_ops_brief_0_1_0_draft_1` in `draft`. |
| Type generation/check | `npm run typecheck` from absent `.next/` output | Passed; `next typegen` regenerated route types and TypeScript reported no errors. |
| Contract drift | `npm run contracts:check` | Passed; every committed JSON Schema artifact matched its executable Zod schema. |
| Automated suite | `npm test` | Passed: 10 test files, 57/57 tests in the current workspace. |
| Production build | `npm run build` | Passed; all six routes compiled and typechecked. |
| Combined CI gate | `npm run verify` | Historical clean-install gate passed. The current rerun was environment-limited: `tsx` intermittently failed with `uv_os_get_passwd returned ENOMEM` before reset/build could execute; isolated typecheck, contract drift, and `npm test` passed. |
| Documented startup | `npm run dev` | Started Next.js 16.3.5 at `http://localhost:3000` without an AI key. |

PowerShell on this machine blocks `npm.ps1`; the same commands were invoked with `npm.cmd`. Local sandbox policy also required allowing bundled compiler/build child processes. Neither condition changes repository behavior or command semantics.

## Persisted bootstrap state

After reset, direct read-only SQLite queries observed:

| Table | Rows |
| --- | ---: |
| `schema_migrations` | 1 |
| `assets` | 1 |
| `asset_versions` | 1 |
| `lifecycle_events` | 1 |
| `evidence` | 0 |
| `executions` | 0 |

The only asset version was `av_property_ops_brief_0_1_0_draft_1`, with lifecycle `draft` and `subject_digest = null`. The stored lifecycle event matched `fixtures/contracts/lifecycle-event.json`. Tests reproduced seed idempotence, public-draft exclusion, current published inclusion/deprecated exclusion, reset-path rejection, permission-gated publication, JSON/index identity binding, evidence-to-frozen-digest binding, evidence/execution round trips, published-version preservation, and database refusal to mutate version content after a subject digest is set.

## Live HTTP smoke result

The development server was queried through its real route handlers and returned:

```json
{
  "Health": "ok",
  "PublicCount": 0,
  "AdminVersion": "av_property_ops_brief_0_1_0_draft_1",
  "Lifecycle": "draft",
  "SubjectDigestIsNull": true,
  "Warning": true,
  "PublishedClaim": false,
  "TryControl": false,
  "PublicContainsDraft": false,
  "SkipLink": true
}
```

The public page and `/api/catalog` did not contain the draft ID. The admin response parsed against the canonical response schema. The admin preview rendered the explicit draft/not-reviewed warning and contained no Try control.

## Official-input verification

Before populating the active state files, all six coordination files were byte-for-byte copies of their official ZIP entries in the mandated paths. The assigned Marketplace brief was copied byte-for-byte to `01_Sponsor_Inputs/05_Realpage AI Marketplace Brief.pdf`; its SHA-256 is `AEDAF2F727E471ECF493FD8E1DD51AC4DBEF53F76BCAFC0DEFFD114AC76D1D90`.

## Not proven by this report

- The proposed hero scope has not been confirmed by a human team member.
- No executor, definition digest, frozen subject digest, execution, reuse proof, review, security acceptance, publication evidence, discovery evaluation, measured time saving, or validated audience reach exists.
- Teams/SharePoint placement, team roster, reviewer access, and final-package permissions were not available for verification.
- This local foundation is not a valid final submission by itself.

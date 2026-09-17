# Agent 04 technical security/data boundary for human review

Date: 2026-09-16  
Subject: Property Operations Brief Builder executor `property_ops.brief_builder` / implementation `1.0.0`  
Definition digest: `sha256:be8b5c34fd414d32619f665398d9f710c18004c5f7644ea16e3e591198e2008e`

This document gives the named human prepublication security/data reviewer the exact technical scope to accept or reject. It is not a human review record, does not name a reviewer, and must not be recorded as a passing `security_review` until that person explicitly accepts the scope and limitations against Agent 01's final frozen `subject_digest`.

## Implemented boundary

- The client submits only `asset_version_id`, optional `scenario_label`, and structured `input`. It cannot choose a purpose, executor, implementation, module, script, URL, digest, or configuration.
- The registry contains one server-owned key. Startup and every accepted run reread the reviewed, line-ending-normalized, path-labelled `artifacts.ts` + `executor.ts` + `registration.ts` implementation bundle, input schema, output schema, behavior configuration, and manifest; recomputed hashes and `definition_digest` must match exactly. The hashed registration binds the exact invoked function reference, declared mode, configuration digest, and denied capabilities.
- The execution service independently enforces lifecycle, current-published pointer for public runs, unpublished/frozen status for maintainer runs, availability, permissions, allowlist membership, canonical subject digest, definition digest, schema digests, input/output schemas, size limits, timeout, secret screening, and high-impact/production-action guardrails.
- The executor is deterministic and has no approved outbound integration, network access, filesystem access, or production side effect. It transforms supplied strings only. Tests spy on `fetch` and scan reviewed source for dynamic evaluation, dynamic import, process execution, filesystem, and network primitives.
- Accepted runs persist pending, running, and terminal state through one repository boundary. Final records retain unique execution ID, exact asset/version, executor key, definition digest, validated input, safe model/configuration, validation results, output or safe error, and timestamps.
- The public renderer uses React text nodes and a fixed output/provenance allowlist. It does not render HTML/Markdown, executor error details, validated input, or configuration parameters.
- The maintainer harness is a code-only module. There is no maintainer/prepublication API or UI route, and the strict request schema rejects caller-supplied purpose and executor fields.

## Data handling

- Intended inputs are approved synthetic observations. Accepted validated input and result provenance are stored as JSON in the local SQLite database.
- Common secret-shaped keys, credentials, tokens, private keys, credential URLs, and JWT-like values are rejected in both input and scenario labels before `validated_input`/label persistence. Raw executor exception messages are discarded; persisted and returned failures use fixed safe messages.
- Output is bounded, JSON-only, re-screened for secret-shaped values, validated against the frozen output schema, and rendered through fixed structured fields.
- There is no data transfer to an external provider or integration in this implementation.

## Explicit limitations for acceptance

1. Secret detection is pattern-based and is not comprehensive DLP. Users must still provide sanitized, approved synthetic data.
2. High-impact detection is a conservative lexical guardrail, not a policy classifier. It can have false positives and false negatives; the asset remains human-review-only and cannot automate a decision or action.
3. The timeout bounds how long the service awaits an executor promise. JavaScript cannot preempt arbitrary CPU-bound code; safety relies on the registry accepting only this reviewed implementation.
4. “No network/filesystem” is enforced by the reviewed code, exact artifact digest, empty capability declaration, and tests, not by a separate OS/container sandbox.
5. The public endpoint has bounded request/output size but no feature-local authentication, rate limiter, quota, or distributed abuse control. It may execute only the current published allowlisted version.
6. Accepted inputs and outputs are stored unencrypted at the application layer in the configured SQLite database. Host access controls, backup policy, retention, and deletion policy are outside this feature's scope.
7. The artifact loader locates reviewed source artifacts at or above the application working directory. Missing or changed deployment artifacts fail startup/readiness closed. Production builds intentionally trace these server-side artifacts so readiness can reread them.
8. Automated tests and evidence candidates are not penetration testing, privacy review, legal review, source-permission attestation, or human security/data acceptance.
9. Existing administrative catalog routes and broader application authentication are outside Agent 04's execution slice. No administrative execution route was added.
10. Terminal-state immutability and provenance-field immutability are enforced by the execution repository with optimistic concurrency, but the current Agent 01-owned SQLite migration does not yet prevent privileged direct SQL update/delete. The requested database-trigger hardening remains a prepublication infrastructure decision.
11. The stable execution contract has no `none`/absent mode for requests blocked before executor selection. A blocked call against a `reference_only` version therefore records the service fallback mode `deterministic`; no executor is invoked and the policy rejection remains explicit, but Agent 01 must resolve the requested preselection-provenance contract change before treating that field as selected-executor provenance.

## Human decision required

The named reviewer should record an explicit accept/reject decision that includes:

- reviewer name, role, organization, and timestamp;
- final `asset_version_id`, artifact version, and frozen `subject_digest`;
- the executor key and definition digest shown above;
- accepted scope and every limitation above (or required changes);
- whether local plaintext persistence and the lack of feature-local rate limiting are acceptable for the demo scope.

Only after explicit acceptance may Agent 05 create a `security_review` record with `result: passed`. Agent 05 must bind it to the same final frozen `subject_digest`; a system actor or automated test must not sign for the reviewer.

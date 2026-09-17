# Agent 02 frontend and catalog handoff

Date: 2026-09-16

## Outcome

The marketplace presentation is implemented as a native Next.js 16 App Router experience using the existing React 19, TypeScript, Zod, server-side catalog service, and global CSS architecture. No UI framework, state library, API contract, migration, execution logic, discovery algorithm, lifecycle transition, or governance decision was added.

## Product truth retained

- Primary workflow: a property-operations or implementation professional finds a reusable asset, inspects its contract and limitations, and reuses it only according to its availability.
- Hero identity remains `asset_property_ops_brief` / `av_property_ops_brief_0_1_0_draft_1` / `0.1.0-draft.1`.
- The hero remains `draft`, `reference_only`, unpublished, without an executor, definition digest, subject digest, evidence, or Try action.
- Both canonical hero scenarios are presented as illustrative planned reuse of the same version; the UI does not imply execution occurred.
- Eight representative published fixtures are all `reference_only`, use `execution_kind: none`, contain no evidence reference, and now derive real subject digests from canonical version content.
- No time-saving number, match percentage, approval badge, security badge, compliance claim, or evidence claim is displayed.

## Pages and components

- `/`: one-screen value proposition, primary workflow, prominent canonical hero preview, truthful hero readiness, before/after workflow, and Browse/Contribute entry points.
- `/catalog`: canonical published records, availability summary, cards, empty state, and truthful note that the complete catalog is shown. Search/filter controls are omitted because the current API has no filter interface.
- `/assets/[assetVersionId]`: purpose, audience, capabilities, use cases, summarized and raw input/output schemas, limitations, setup, maintenance, owner, version, availability, lifecycle, source, license/attribution, permissions, and evidence reference slot.
- `/contribute`: contribution requirements and an honest internal-channel next step; no fake submission workflow.
- Shared presentation: `AvailabilityBadge`, `AssetUsePanel`, `CatalogCard`, `HeroAssetSection`, `WorkflowComparison`, shell, empty state, route loading state, and route error state.

## Integration points

- Server pages read through `withCatalogService`; no fixture-only production model was introduced.
- `/api/catalog` and shared contracts remain unchanged.
- `scripts/db/seed.ts` invokes `seedDatabase` followed by `seedPublishedCatalog`.
- `seedPublishedCatalog` validates persisted rows against canonical fixtures and rejects silent drift.
- `AssetUsePanel` shows Try only when both canonical availability is `runnable` and an actual `tryHref` is supplied by the future execution integration.

## Verification performed

- `npm.cmd run verify`: passed.
- Contract generation/drift check: passed.
- TypeScript and Next route type generation: passed.
- Vitest: 6 files, 36 tests passed.
- Production Next.js build: passed without warnings after narrowing the server import.
- Critical UI tests cover catalog metadata, non-runnable Try suppression, runnable Try-link gating, empty state, loading state, error state, and all eight catalog fixtures/digests.
- Manual route walkthrough: Home 200 -> Catalog 200 with 8 cards -> Asset Detail 200 with no Try -> Contribute 200.
- Practical accessibility audit: each reviewed route had one `h1`, a skip link, a matching main landmark, and zero duplicate IDs; semantic labels, visible focus, reduced-motion handling, and keyboard-native links/buttons were inspected.
- Responsive visual smoke: Chrome at 1440, 900, 500, and emulated 390 x 844. Home, Catalog, and Detail each reported viewport `scrollWidth === clientWidth` at 390; no horizontal overflow remained.

## Known limitations

- No search/filter controls are shown because the existing catalog API has no filtering/query contract. Agent 03 owns discovery behavior.
- No asset is runnable, so no execution walkthrough can be completed and no Try action is rendered.
- No axe-core dependency was added; accessibility verification was practical/semantic rather than a full automated WCAG certification.
- The existing local `data/marketplace.sqlite` contains earlier immutable published fixture rows. Source, fresh-database tests, and clean installs use the corrected computed digests and all-reference-only availability. Updating the existing local file requires explicit approval to delete/reset its records.

## Exact Agent 01 actions

1. Review and merge `docs/requests/agent-01-catalog-ledger-change.md`; record only verified catalog/source facts in official state files.
2. Confirm whether the disposable local database may be reset. If approved, run `npm.cmd run db:reset` and then `npm.cmd run db:seed`; this deletes existing local SQLite records.
3. Accept the unchanged hero draft fixture at Checkpoint A. Do not mark it runnable yet.
4. After Agent 04 supplies the reviewed executor manifest and implementation digest, Agent 01 alone updates runnable metadata, computes/freezes `subject_digest`, and supplies the real execution route to the frontend integration.
5. Keep the hero unpublished until all current-digest gates pass; any later content change requires a new version and evidence cycle.

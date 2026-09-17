import {
  AssetSchema,
  AssetVersionContentSchema,
  AssetVersionRecordSchema,
  EvidenceSchema,
  LifecycleEventSchema,
  SemVerSchema,
  type ActorType,
  type AssetVersionContent,
  type AssetVersionRecord,
  type Evidence,
  type EvidenceType,
  type LifecycleState,
} from "@/contracts";
import type { Clock, ExecutorLookup, IdGenerator } from "@/shared/ports";
import { computeSubjectDigest } from "@/shared/integrity";

import { GovernanceError, issuesFromZod } from "./errors";
import {
  CreateContributionInputSchema,
  CreateDraftFromPublishedInputSchema,
  DemoReviewInputSchema,
  TransitionInputSchema,
  type CreateContributionInput,
  type CreateDraftFromPublishedInput,
  type DemoReviewInput,
  type TransitionInput,
} from "./inputs";
import {
  SECURITY_ACCEPTANCE_ASSERTION,
  buildGovernanceHistory,
  buildGovernanceProjection,
  type GovernanceExecutionReader,
} from "./projection";
import { GovernanceRepository } from "./repository";

const ALLOWED_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  draft: ["submitted"],
  submitted: ["in_review"],
  in_review: ["changes_requested", "published"],
  changes_requested: ["submitted"],
  published: ["deprecated"],
  deprecated: [],
};

const REVIEWER_TRANSITIONS = new Set<LifecycleState>([
  "in_review",
  "changes_requested",
  "published",
  "deprecated",
]);

export const PROTOTYPE_REVIEW_LIMITATION =
  "Prototype limitation: authentication is not implemented. Reviewer names are manually entered and recorded as demo-reviewer attestations; they are not identity-verified organizational approvals.";

function timestamp(clock: Clock): string {
  return clock.now().toISOString();
}

function contentFromRecord(record: AssetVersionRecord): AssetVersionContent {
  const {
    lifecycle: _lifecycle,
    subject_digest: _subjectDigest,
    published_at: _publishedAt,
    deprecated_at: _deprecatedAt,
    replacement_version: _replacementVersion,
    ...content
  } = record.asset_version;
  return AssetVersionContentSchema.parse(content);
}

function assertFrozenDigest(record: AssetVersionRecord): string {
  const digest = record.asset_version.subject_digest;
  if (digest === null) {
    throw new GovernanceError(
      422,
      "subject_not_frozen",
      "Freeze the final version content and subject digest before recording evidence.",
    );
  }
  if (computeSubjectDigest(contentFromRecord(record)) !== digest) {
    throw new GovernanceError(
      422,
      "subject_digest_mismatch",
      "The stored subject digest does not match the exact version content.",
    );
  }
  return digest;
}

function actorForEvent(
  actorType: Exclude<ActorType, "system">,
  actorName: string,
): { actor_type: Exclude<ActorType, "system">; actor_name: string } {
  return { actor_type: actorType, actor_name: actorName };
}

function isSyntheticEventMaterial(record: AssetVersionRecord, text = ""): boolean {
  if (record.asset_version.source_class !== "created_during_event") return false;
  return /synthetic/i.test(
    [
      record.asset_version.source_reference ?? "",
      record.asset_version.summary,
      record.asset_version.description,
      ...record.asset_version.test_scenarios.map((scenario) => scenario.description),
      text,
    ].join(" "),
  );
}

export interface GovernanceDetail {
  record: AssetVersionRecord;
  evidence: Evidence[];
  events: ReturnType<GovernanceRepository["listLifecycleEvents"]>;
  projection: ReturnType<typeof buildGovernanceProjection>;
  history: ReturnType<typeof buildGovernanceHistory>;
  prototype_limitation: string;
}

export interface GovernanceQueueItem {
  record: AssetVersionRecord;
  projection: ReturnType<typeof buildGovernanceProjection>;
}

export class GovernanceService {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly executorLookup?: ExecutorLookup,
    private readonly executionReader?: GovernanceExecutionReader,
  ) {}

  createContribution(inputValue: unknown): AssetVersionRecord {
    const parsed = CreateContributionInputSchema.safeParse(inputValue);
    if (!parsed.success) {
      throw new GovernanceError(
        422,
        "invalid_contribution",
        "The contribution has invalid or missing metadata.",
        issuesFromZod(parsed.error.issues),
      );
    }
    const input: CreateContributionInput = parsed.data;
    const now = timestamp(this.clock);
    const assetId = this.ids.next("asset");
    const assetVersionId = this.ids.next("av");
    const asset = AssetSchema.parse({
      asset_id: assetId,
      slug: input.slug,
      current_published_version_id: null,
      created_at: now,
      updated_at: now,
    });
    const content = AssetVersionContentSchema.parse({
      ...input.content,
      asset_id: assetId,
      asset_version_id: assetVersionId,
      created_at: now,
    });
    const candidate = AssetVersionRecordSchema.safeParse({
      asset,
      asset_version: {
        ...content,
        lifecycle: "draft",
        subject_digest: null,
        published_at: null,
        deprecated_at: null,
        replacement_version: null,
      },
    });
    if (!candidate.success) {
      throw new GovernanceError(
        422,
        "invalid_contribution",
        "The contribution cannot be created until its metadata issues are resolved.",
        issuesFromZod(candidate.error.issues),
      );
    }
    const event = LifecycleEventSchema.parse({
      event_id: this.ids.next("event"),
      asset_id: assetId,
      asset_version_id: assetVersionId,
      to_state: "draft",
      ...actorForEvent("team_member", input.actor_name),
      reason: "Contributor created a non-runnable draft for human review.",
      evidence_ids: [],
      timestamp: now,
    });
    try {
      return this.repository.insertDraft(asset, content, event);
    } catch (error) {
      throw new GovernanceError(
        409,
        "contribution_conflict",
        "The slug, version, or generated contribution identity conflicts with an existing record.",
      );
    }
  }

  updateEditableDraft(assetVersionId: string, contentValue: unknown): AssetVersionRecord {
    const current = this.requireVersion(assetVersionId);
    if (current.asset_version.lifecycle === "published" || current.asset_version.lifecycle === "deprecated") {
      throw new GovernanceError(
        409,
        "published_version_immutable",
        "Published version content is immutable. Create a distinct draft version before editing.",
      );
    }
    if (
      current.asset_version.lifecycle !== "draft" &&
      current.asset_version.lifecycle !== "changes_requested"
    ) {
      throw new GovernanceError(
        409,
        "version_not_editable",
        "Only draft or changes-requested versions can be edited.",
      );
    }
    if (current.asset_version.subject_digest !== null) {
      throw new GovernanceError(
        409,
        "frozen_version_immutable",
        "Frozen version content is immutable. Create a distinct draft version before editing.",
      );
    }
    const parsed = AssetVersionContentSchema.safeParse(contentValue);
    if (!parsed.success) {
      throw new GovernanceError(
        422,
        "invalid_contribution",
        "The edited draft has invalid or missing metadata.",
        issuesFromZod(parsed.error.issues),
      );
    }
    const next = parsed.data;
    const previous = contentFromRecord(current);
    if (
      next.asset_id !== previous.asset_id ||
      next.asset_version_id !== previous.asset_version_id ||
      next.version !== previous.version ||
      next.created_at !== previous.created_at
    ) {
      throw new GovernanceError(
        422,
        "immutable_identity_changed",
        "Asset ID, version ID, semantic version, and created timestamp cannot be edited.",
      );
    }
    if (previous.executor_key === undefined) {
      if (
        next.availability === "runnable" ||
        next.execution_kind !== "none" ||
        next.executor_key !== undefined ||
        next.definition_digest !== undefined
      ) {
        throw new GovernanceError(
          422,
          "contribution_cannot_add_executor",
          "Contribution metadata cannot create executable behavior. A maintainer must implement and allowlist an executor.",
        );
      }
    } else if (
      next.executor_key !== previous.executor_key ||
      next.definition_digest !== previous.definition_digest
    ) {
      throw new GovernanceError(
        422,
        "executor_identity_changed",
        "Executor identity and definition digest may be changed only through the maintainer integration workflow.",
      );
    }
    try {
      return this.repository.replaceEditableContent(next);
    } catch {
      throw new GovernanceError(
        409,
        "version_not_editable",
        "The version was frozen or changed state before the edit could be saved.",
      );
    }
  }

  createDraftFromPublished(
    assetVersionId: string,
    inputValue: unknown,
  ): AssetVersionRecord {
    const parsed = CreateDraftFromPublishedInputSchema.safeParse(inputValue);
    if (!parsed.success) {
      throw new GovernanceError(
        422,
        "invalid_draft_request",
        "A new semantic version, actor name, and reason are required.",
        issuesFromZod(parsed.error.issues),
      );
    }
    const input: CreateDraftFromPublishedInput = parsed.data;
    const semver = SemVerSchema.safeParse(input.version);
    if (!semver.success) {
      throw new GovernanceError(422, "invalid_version", semver.error.issues[0]?.message ?? "Invalid semantic version.");
    }
    const source = this.requireVersion(assetVersionId);
    if (source.asset_version.published_at === null) {
      throw new GovernanceError(
        409,
        "source_not_published",
        "Only a version that has been published can be copied into a new edit draft.",
      );
    }
    const now = timestamp(this.clock);
    const newVersionId = this.ids.next("av");
    const content = AssetVersionContentSchema.parse({
      ...contentFromRecord(source),
      asset_version_id: newVersionId,
      version: semver.data,
      created_at: now,
    });
    const event = LifecycleEventSchema.parse({
      event_id: this.ids.next("event"),
      asset_id: source.asset.asset_id,
      asset_version_id: newVersionId,
      to_state: "draft",
      ...actorForEvent("team_member", input.actor_name),
      reason: `${input.reason} Source version: ${assetVersionId}.`,
      evidence_ids: [],
      timestamp: now,
    });
    try {
      return this.repository.insertDraftForExistingAsset(content, event);
    } catch {
      throw new GovernanceError(
        409,
        "draft_version_conflict",
        "That asset already has the requested semantic version.",
      );
    }
  }

  transition(assetVersionId: string, inputValue: unknown): AssetVersionRecord {
    const parsed = TransitionInputSchema.safeParse(inputValue);
    if (!parsed.success) {
      throw new GovernanceError(
        422,
        "invalid_transition_request",
        "The lifecycle transition request is invalid.",
        issuesFromZod(parsed.error.issues),
      );
    }
    const input: TransitionInput = parsed.data;
    const record = this.requireVersion(assetVersionId);
    const from = record.asset_version.lifecycle;
    if (!ALLOWED_TRANSITIONS[from].includes(input.to_state)) {
      throw new GovernanceError(
        409,
        "unsupported_transition",
        `Lifecycle transition ${from} → ${input.to_state} is not supported.`,
      );
    }
    if (REVIEWER_TRANSITIONS.has(input.to_state) && input.actor_type !== "demo_reviewer") {
      throw new GovernanceError(
        422,
        "reviewer_action_required",
        `${from} → ${input.to_state} requires an explicit reviewer action.`,
      );
    }
    if (input.to_state !== "deprecated" && input.replacement_version !== undefined) {
      throw new GovernanceError(
        422,
        "replacement_not_allowed",
        "A replacement version may be supplied only when deprecating a published version.",
      );
    }

    const evidence = this.repository.listEvidence(assetVersionId);
    let evidenceIds: string[] = [];
    if (input.to_state === "published") {
      if (input.confirm_publication !== true) {
        throw new GovernanceError(
          422,
          "publication_confirmation_required",
          "Publication requires an explicit manual reviewer confirmation.",
        );
      }
      evidenceIds = this.requirePassingPublicationGates(
        record,
        evidence,
        input.actor_name,
      );
    }

    if (input.to_state === "deprecated" && input.replacement_version !== undefined) {
      if (input.replacement_version === assetVersionId) {
        throw new GovernanceError(
          422,
          "invalid_replacement_version",
          "A version cannot replace itself.",
        );
      }
      const replacement = this.repository.getVersionById(input.replacement_version);
      if (
        replacement === null ||
        replacement.asset.asset_id !== record.asset.asset_id ||
        replacement.asset_version.lifecycle !== "published"
      ) {
        throw new GovernanceError(
          422,
          "invalid_replacement_version",
          "The replacement must be another published version of the same asset.",
        );
      }
    }

    const now = timestamp(this.clock);
    const event = LifecycleEventSchema.parse({
      event_id: this.ids.next("event"),
      asset_id: record.asset.asset_id,
      asset_version_id: assetVersionId,
      from_state: from,
      to_state: input.to_state,
      ...actorForEvent(input.actor_type, input.actor_name),
      reason: input.reason,
      evidence_ids: evidenceIds,
      timestamp: now,
    });
    try {
      return this.repository.applyTransition({
        assetVersionId,
        expectedFrom: from,
        toState: input.to_state,
        event,
        ...(input.to_state === "published" ? { publishedAt: now } : {}),
        ...(input.to_state === "deprecated" ? { deprecatedAt: now } : {}),
        replacementVersion: input.replacement_version ?? null,
        ...(input.to_state === "published"
          ? {
              validateCurrent: () => {
                const current = this.repository.getVersionById(assetVersionId);
                if (current === null || current.asset_version.lifecycle !== from) {
                  throw new GovernanceError(
                    409,
                    "transition_conflict",
                    "Lifecycle state changed before publication could be committed.",
                  );
                }
                const currentIds = this.requirePassingPublicationGates(
                  current,
                  this.repository.listEvidence(assetVersionId),
                  input.actor_name,
                );
                if (
                  currentIds.length !== evidenceIds.length ||
                  currentIds.some((id, index) => id !== evidenceIds[index])
                ) {
                  throw new GovernanceError(
                    409,
                    "publication_evidence_changed",
                    "Current publication evidence changed before the lifecycle event could be committed. Review the gates and retry.",
                  );
                }
              },
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof GovernanceError) throw error;
      throw new GovernanceError(
        409,
        "transition_conflict",
        error instanceof Error && /concurrently/.test(error.message)
          ? error.message
          : "The lifecycle transition could not be applied atomically.",
      );
    }
  }

  recordEvidence(assetVersionId: string, evidenceValue: unknown): Evidence {
    const parsed = EvidenceSchema.safeParse(evidenceValue);
    if (!parsed.success) {
      throw new GovernanceError(
        422,
        "invalid_evidence",
        "The evidence record does not satisfy the canonical contract.",
        issuesFromZod(parsed.error.issues),
      );
    }
    const evidence = parsed.data;
    const record = this.requireVersion(assetVersionId);
    const digest = assertFrozenDigest(record);
    if (
      evidence.asset_version_id !== assetVersionId ||
      evidence.asset_id !== record.asset.asset_id
    ) {
      throw new GovernanceError(
        422,
        "evidence_identity_mismatch",
        "Evidence asset and version identities must match the route target.",
      );
    }
    if (evidence.subject_digest !== digest) {
      throw new GovernanceError(
        422,
        "evidence_digest_mismatch",
        "Evidence must be bound to the exact current subject digest.",
      );
    }
    if (evidence.artifact_version !== record.asset_version.version) {
      throw new GovernanceError(
        422,
        "evidence_artifact_version_mismatch",
        "Evidence artifact version must match the exact catalog version.",
      );
    }
    if (
      ["human_review", "security_review", "source_permission"].includes(
        evidence.evidence_type,
      ) &&
      (evidence.actor_type === "system" || evidence.reviewer === undefined)
    ) {
      throw new GovernanceError(
        422,
        "named_human_evidence_required",
        "Human, security, and source-permission outcomes require a named human reviewer.",
      );
    }
    if (evidence.result === "not_applicable") {
      if (
        evidence.evidence_type !== "source_permission" ||
        !isSyntheticEventMaterial(
          record,
          `${evidence.scope} ${evidence.details.summary} ${JSON.stringify(evidence.observed)}`,
        ) ||
        !/not[ _-]?applicable/i.test(
          `${evidence.scope} ${evidence.details.summary} ${JSON.stringify(evidence.observed)}`,
        )
      ) {
        throw new GovernanceError(
          422,
          "not_applicable_not_allowed",
          "Only source-permission evidence for documented event-created synthetic material may be not applicable.",
        );
      }
    }
    this.assertExecutionEvidence(record, evidence);
    try {
      return this.repository.insertEvidence(evidence);
    } catch {
      throw new GovernanceError(
        409,
        "evidence_conflict",
        "The evidence record already exists or failed its immutable digest binding.",
      );
    }
  }

  /**
   * Locks the content of an editable version by computing and storing its
   * subject digest. Every check is bound to that digest, so nothing can be
   * evidenced until this has happened, and the content can never change
   * afterwards without producing a new version.
   */
  freezeVersion(assetVersionId: string): AssetVersionRecord {
    const record = this.requireVersion(assetVersionId);
    const lifecycle = record.asset_version.lifecycle;
    if (lifecycle !== "draft" && lifecycle !== "changes_requested") {
      throw new GovernanceError(
        409,
        "version_not_freezable",
        "Only a draft or changes-requested version can be frozen.",
      );
    }
    if (record.asset_version.subject_digest !== null) {
      throw new GovernanceError(
        409,
        "version_already_frozen",
        "This version is already frozen. Its content and digest can never change.",
      );
    }
    const candidate = AssetVersionRecordSchema.safeParse(record);
    if (!candidate.success) {
      throw new GovernanceError(
        422,
        "invalid_version_content",
        "The version cannot be frozen until its metadata issues are resolved.",
        issuesFromZod(candidate.error.issues),
      );
    }
    const digest = computeSubjectDigest(contentFromRecord(record));
    try {
      return this.repository.freezeSubjectDigest(assetVersionId, digest);
    } catch {
      throw new GovernanceError(
        409,
        "freeze_conflict",
        "The version was frozen or changed state before the freeze could be saved.",
      );
    }
  }

  runMetadataValidation(assetVersionId: string): Evidence {
    const record = this.requireVersion(assetVersionId);
    const digest = assertFrozenDigest(record);
    const permissionsResolved = [
      record.asset_version.access_permission,
      record.asset_version.tool_use_permission,
      record.asset_version.final_package_permission,
    ].every((permission) => permission !== "unconfirmed");
    const contractValid = AssetVersionRecordSchema.safeParse(record).success;
    const digestMatches = computeSubjectDigest(contentFromRecord(record)) === digest;
    const assertions = [
      {
        name: "Canonical asset-version contract",
        passed: contractValid,
        observed: contractValid ? "Contract valid." : "Contract invalid.",
      },
      {
        name: "Exact subject digest",
        passed: digestMatches,
        observed: digestMatches ? digest : "Digest mismatch.",
      },
      {
        name: "Permission decisions resolved",
        passed: permissionsResolved,
        observed: permissionsResolved
          ? "All permission decisions are resolved."
          : "One or more permissions remain unconfirmed.",
      },
    ];
    const passed = assertions.every((assertion) => assertion.passed);
    return this.recordEvidence(
      assetVersionId,
      EvidenceSchema.parse({
        evidence_id: this.ids.next("evidence"),
        asset_id: record.asset.asset_id,
        asset_version_id: assetVersionId,
        subject_digest: digest,
        evidence_type: "metadata_validation",
        scope: "Canonical metadata, permission decisions, artifact version, and exact subject digest.",
        expected: { contract_valid: true, digest_matches: true, permissions_resolved: true },
        observed: { contract_valid: contractValid, digest_matches: digestMatches, permissions_resolved: permissionsResolved },
        result: passed ? "passed" : "failed",
        actor_type: "system",
        timestamp: timestamp(this.clock),
        method: "Deterministic canonical contract and digest validation; no AI approval or lifecycle action.",
        execution_ids: [],
        artifact_version: record.asset_version.version,
        details: {
          summary: passed
            ? "Metadata validation passed for the exact frozen subject."
            : "Metadata validation found issues that must be resolved in a new draft/version.",
          assertions,
          data: { deterministic: true, ai_approval: false },
        },
        limitations: [
          "Metadata validation does not constitute human, security, functional, or source-permission approval.",
        ],
      }),
    );
  }

  recordDemoReview(assetVersionId: string, inputValue: unknown): Evidence {
    const parsed = DemoReviewInputSchema.safeParse(inputValue);
    if (!parsed.success) {
      throw new GovernanceError(
        422,
        "invalid_demo_review",
        "The manual demo-review record is invalid.",
        issuesFromZod(parsed.error.issues),
      );
    }
    const input: DemoReviewInput = parsed.data;
    const record = this.requireVersion(assetVersionId);
    if (record.asset_version.lifecycle !== "in_review") {
      throw new GovernanceError(
        409,
        "review_not_active",
        "Manual review evidence may be recorded only while the version is in review.",
      );
    }
    if (input.review_type !== "source_permission" && input.result === "not_applicable") {
      throw new GovernanceError(
        422,
        "not_applicable_not_allowed",
        "Human and security review cannot be marked not applicable.",
      );
    }
    if (
      input.review_type === "source_permission" &&
      input.result === "not_applicable" &&
      (!isSyntheticEventMaterial(record, `${input.scope} ${input.summary}`) ||
        !/not[ _-]?applicable/i.test(`${input.scope} ${input.summary}`))
    ) {
      throw new GovernanceError(
        422,
        "not_applicable_not_allowed",
        "Document why source permission is not applicable and identify the material as event-created synthetic content.",
      );
    }
    if (input.review_type === "security_review" && input.result === "passed") {
      const currentHuman = buildGovernanceProjection(
        record,
        this.repository.listEvidence(assetVersionId),
        this.executorLookup,
        this.executionReader,
      ).evidence.find(
        (item) => item.evidence.evidence_type === "human_review" && item.state === "passed",
      );
      if (
        input.accept_scoped_security_review !== true ||
        currentHuman?.evidence.reviewer?.name !== input.reviewer_name ||
        !/security/i.test(input.scope) ||
        !/data/i.test(input.scope)
      ) {
        throw new GovernanceError(
          422,
          "security_acceptance_required",
          "The named passing human reviewer must explicitly accept a scope covering security and data handling.",
        );
      }
    }
    const digest = assertFrozenDigest(record);
    const passing = input.result === "passed" || input.result === "not_applicable";
    const assertionName =
      input.review_type === "security_review"
        ? SECURITY_ACCEPTANCE_ASSERTION
        : input.review_type === "human_review"
          ? "Named human reviewer completed prepublication review"
          : "Named reviewer documented the source-permission outcome";
    const reviewer = {
      name: input.reviewer_name,
      ...(input.reviewer_role === undefined ? {} : { role: input.reviewer_role }),
      ...(input.reviewer_organization === undefined
        ? {}
        : { organization: input.reviewer_organization }),
    };
    const observed = {
      outcome: input.result,
      reviewer_name: input.reviewer_name,
      scope: input.scope,
      prototype_identity_verified: false,
    };
    return this.recordEvidence(
      assetVersionId,
      EvidenceSchema.parse({
        evidence_id: this.ids.next("evidence"),
        asset_id: record.asset.asset_id,
        asset_version_id: assetVersionId,
        subject_digest: digest,
        evidence_type: input.review_type as EvidenceType,
        scope: input.scope,
        expected: { explicit_human_outcome: true },
        observed,
        result: input.result,
        actor_type: "demo_reviewer",
        actor_name: input.reviewer_name,
        reviewer,
        timestamp: timestamp(this.clock),
        method: "Explicit manual action in the unauthenticated prototype review UI.",
        execution_ids: [],
        artifact_version: record.asset_version.version,
        details: {
          summary: input.summary,
          assertions: [
            {
              name: assertionName,
              passed: passing,
              observed: `${input.result} recorded by ${input.reviewer_name}.`,
            },
          ],
          data: {
            prototype_manual_review: true,
            identity_verified: false,
            ...(input.review_type === "security_review"
              ? {
                  prepublication_reviewer_accepted:
                    input.accept_scoped_security_review === true,
                  prepublication_reviewer_name: input.reviewer_name,
                }
              : {}),
          },
        },
        limitations: [PROTOTYPE_REVIEW_LIMITATION],
      }),
    );
  }

  getDetail(assetVersionId: string): GovernanceDetail {
    const record = this.requireVersion(assetVersionId);
    const evidence = this.repository.listEvidence(assetVersionId);
    const events = this.repository.listLifecycleEvents(assetVersionId);
    return {
      record,
      evidence,
      events,
      projection: buildGovernanceProjection(
        record,
        evidence,
        this.executorLookup,
        this.executionReader,
      ),
      history: buildGovernanceHistory(events, evidence),
      prototype_limitation: PROTOTYPE_REVIEW_LIMITATION,
    };
  }

  listQueue(): GovernanceQueueItem[] {
    return this.repository.listVersions().map((record) => ({
      record,
      projection: buildGovernanceProjection(
        record,
        this.repository.listEvidence(record.asset_version.asset_version_id),
        this.executorLookup,
        this.executionReader,
      ),
    }));
  }

  private requireVersion(assetVersionId: string): AssetVersionRecord {
    const record = this.repository.getVersionById(assetVersionId);
    if (record === null) {
      throw new GovernanceError(404, "asset_version_not_found", "Asset version not found.");
    }
    return record;
  }

  private requirePassingPublicationGates(
    record: AssetVersionRecord,
    evidence: readonly Evidence[],
    actorName: string,
  ): string[] {
    const projection = buildGovernanceProjection(
      record,
      evidence,
      this.executorLookup,
      this.executionReader,
    );
    if (!projection.canPublish) {
      throw new GovernanceError(
        422,
        "publication_gates_failed",
        "Publication is blocked until every required current-digest gate passes.",
        projection.gates
          .filter((gate) => gate.required && gate.status !== "passed")
          .map((gate) => ({ path: gate.key, message: gate.message })),
      );
    }
    const humanReview = projection.evidence.find(
      (item) =>
        item.evidence.evidence_type === "human_review" && item.state === "passed",
    );
    if (humanReview?.evidence.reviewer?.name !== actorName) {
      throw new GovernanceError(
        422,
        "publishing_reviewer_mismatch",
        "The named reviewer who passed the current human review must perform publication.",
      );
    }
    return projection.gates.flatMap((gate) =>
      gate.status === "passed" && gate.evidenceId !== undefined
        ? [gate.evidenceId]
        : [],
    );
  }

  private assertExecutionEvidence(
    record: AssetVersionRecord,
    evidence: Evidence,
  ): void {
    if (!(["functional_test", "guardrail_test", "reuse_test"] as EvidenceType[]).includes(evidence.evidence_type)) {
      return;
    }
    const minimum = evidence.evidence_type === "reuse_test" ? 2 : 1;
    if (evidence.execution_ids.length < minimum || this.executionReader === undefined) {
      throw new GovernanceError(
        422,
        "execution_evidence_missing",
        `${evidence.evidence_type.replaceAll("_", " ")} evidence requires ${minimum} or more persisted execution record${minimum === 1 ? "" : "s"}.`,
      );
    }
    if (
      evidence.evidence_type === "reuse_test" &&
      new Set(evidence.execution_ids).size !== evidence.execution_ids.length
    ) {
      throw new GovernanceError(
        422,
        "execution_evidence_duplicate",
        "Reuse evidence requires distinct persisted execution records.",
      );
    }
    const records = evidence.execution_ids.map((id) => this.executionReader?.getById(id));
    if (
      records.some(
        (execution) =>
          execution === null ||
          execution === undefined ||
          execution.asset_id !== record.asset.asset_id ||
          execution.asset_version_id !== record.asset_version.asset_version_id ||
          execution.asset_version !== record.asset_version.version ||
          execution.purpose !== "prepublication_test",
      )
    ) {
      throw new GovernanceError(
        422,
        "execution_evidence_mismatch",
        "Every execution-backed evidence record must reference persisted prepublication executions for the exact asset version.",
      );
    }
  }
}

export { ALLOWED_TRANSITIONS };

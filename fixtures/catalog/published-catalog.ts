import {
  AssetVersionContentSchema,
  AssetVersionRecordSchema,
  type AssetVersionRecord,
  type EvidenceResult,
  type EvidenceType,
} from "../../src/contracts";
import {
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
  PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
} from "../../src/modules/execution/executors/property-operations-brief/artifacts";
import { computeSubjectDigest } from "../../src/shared/integrity";

const DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

/**
 * Evidence the demo seed materializes for a version. The seed binds every row
 * to that version's own frozen digest, so no fixture can bypass the database
 * integrity triggers.
 */
export interface DemoEvidencePlan {
  evidence_type: EvidenceType;
  result: EvidenceResult;
  actor: "system" | "reviewer";
  reviewer_name?: string;
  reviewer_role?: string;
  scope: string;
  method: string;
  summary: string;
  assertions: { name: string; passed: boolean; observed: string }[];
  /** Structured evidence payload; the security gate reads reviewer acceptance from it. */
  data?: Record<string, string | boolean>;
  /** Hours before the seed instant, so freshness signals are meaningful. */
  hours_ago: number;
  limitations: string[];
}

export interface DemoCatalogEntry {
  record: AssetVersionRecord;
  evidence: DemoEvidencePlan[];
  /** True when this version owns the asset's public `current_published_version_id`. */
  current: boolean;
}

interface CatalogSeedInput {
  assetId: string;
  slug: string;
  versionId: string;
  version: string;
  name: string;
  summary: string;
  description: string;
  owner: string;
  assetType: "skill" | "workflow" | "template" | "dashboard" | "plugin" | "agent" | "other";
  domains: string[];
  audiences: string[];
  capabilities: string[];
  useCases: string[];
  limitations: string[];
  usage: string;
  setup: string;
  maintenance: string;
  inputFields: Record<string, { type: string }>;
  outputFields: Record<string, { type: string }>;
  createdAt: string;
  publishedAt: string;
  evidence: DemoEvidencePlan[];
  current?: boolean;
}

const systemMetadata = (hoursAgo: number): DemoEvidencePlan => ({
  evidence_type: "metadata_validation",
  result: "passed",
  actor: "system",
  scope: "Deterministic contract, digest, and permission-decision validation.",
  method:
    "Recomputed the canonical subject digest and re-validated the frozen contract against the published schema.",
  summary: "The frozen contract, subject digest, and permission decisions agree.",
  assertions: [
    {
      name: "Subject digest matches the frozen content",
      passed: true,
      observed: "Recomputed digest equals the stored digest.",
    },
    {
      name: "No permission decision remains unconfirmed",
      passed: true,
      observed: "Access, tool-use, and final-package decisions are resolved.",
    },
  ],
  hours_ago: hoursAgo,
  limitations: [
    "Deterministic validation cannot approve, publish, or substitute for human review.",
  ],
});

const humanReview = (
  name: string,
  role: string,
  hoursAgo: number,
  observed: string,
): DemoEvidencePlan => ({
  evidence_type: "human_review",
  result: "passed",
  actor: "reviewer",
  reviewer_name: name,
  reviewer_role: role,
  scope: "Reviewed purpose, audience fit, limitations, and the documented human-review boundary.",
  method: "Manual prototype review of the frozen version content by a named demo reviewer.",
  summary: observed,
  assertions: [
    { name: "Purpose and audience are accurate", passed: true, observed },
    {
      name: "Limitations disclose the human-review boundary",
      passed: true,
      observed: "The version states that a human owns the final decision.",
    },
  ],
  hours_ago: hoursAgo,
  limitations: [
    "Prototype attestation only. Reviewer identity is not authenticated.",
  ],
});

const sourcePermission = (hoursAgo: number): DemoEvidencePlan => ({
  evidence_type: "source_permission",
  result: "passed",
  actor: "system",
  scope: "Recorded the source class and the three separate permission decisions.",
  method: "Checked access, tool-use, and final-package permissions against the declared source class.",
  summary: "The asset was created during the event from synthetic material with resolved permissions.",
  assertions: [
    {
      name: "Source class is recorded",
      passed: true,
      observed: "created_during_event with a synthetic source reference.",
    },
    {
      name: "Access, tool-use, and final-package decisions are resolved",
      passed: true,
      observed: "No decision remains unconfirmed.",
    },
  ],
  hours_ago: hoursAgo,
  limitations: ["Synthetic event-created material only; no customer data is involved."],
});

const securityReview = (
  name: string,
  role: string,
  hoursAgo: number,
): DemoEvidencePlan => ({
  evidence_type: "security_review",
  result: "passed",
  actor: "reviewer",
  reviewer_name: name,
  reviewer_role: role,
  scope:
    "Scoped security and data-handling review of inputs, data handling, and failure behavior for this version only.",
  method: "Manual prototype security and data-handling review of the frozen version content.",
  summary: "Scoped review found no secret handling, no network egress, and no automated decision path.",
  assertions: [
    {
      name: "Named prepublication reviewer accepted the scoped security and data-handling review",
      passed: true,
      observed: "Review covered documented inputs and limitations only.",
    },
    {
      name: "No credential, token, or restricted content is embedded",
      passed: true,
      observed: "The version content contains no secret material.",
    },
  ],
  data: {
    prepublication_reviewer_accepted: true,
    prepublication_reviewer_name: name,
    review_scope: "Reviewed inputs, data handling, and failure behavior for this version only.",
  },
  hours_ago: hoursAgo,
  limitations: [
    "Scoped to the reviewed content. It is not a blanket approval of every downstream use.",
  ],
});

function buildEntry(input: CatalogSeedInput): DemoCatalogEntry {
  const isCurrent = input.current ?? true;
  const content = AssetVersionContentSchema.parse({
    asset_version_id: input.versionId,
    asset_id: input.assetId,
    version: input.version,
    name: input.name,
    summary: input.summary,
    owner: input.owner,
    asset_type: input.assetType,
    execution_kind: "none",
    description: input.description,
    audiences: input.audiences,
    domains: input.domains,
    capabilities: input.capabilities,
    use_cases: input.useCases,
    input_schema: { $schema: DIALECT, type: "object", properties: input.inputFields },
    output_schema: { $schema: DIALECT, type: "object", properties: input.outputFields },
    limitations: input.limitations,
    usage_instructions: input.usage,
    setup_expectations: input.setup,
    maintenance_expectations: input.maintenance,
    test_scenarios: [],
    availability: "reference_only",
    source_class: "created_during_event",
    source_reference: "Synthetic event-created catalog fixture",
    license_id: null,
    attribution: null,
    permission_evidence_id: null,
    access_permission: "not_applicable",
    tool_use_permission: "not_applicable",
    final_package_permission: "not_applicable",
    created_at: input.createdAt,
  });

  const record = AssetVersionRecordSchema.parse({
    asset: {
      asset_id: input.assetId,
      slug: input.slug,
      current_published_version_id: isCurrent ? input.versionId : null,
      created_at: input.createdAt,
      updated_at: input.publishedAt,
    },
    asset_version: {
      ...content,
      lifecycle: "published",
      subject_digest: computeSubjectDigest(content),
      published_at: input.publishedAt,
      deprecated_at: null,
      replacement_version: null,
    },
  });

  return { record, evidence: input.evidence, current: isCurrent };
}

/**
 * The hero asset version. It is seeded as a frozen runnable draft so the demo
 * seed can drive it through the real prepublication and publication path
 * instead of asserting a published state that no gate ever checked.
 */
export const HERO_ASSET_ID = "asset_property_ops_brief";
export const HERO_VERSION_ID = "av_property_ops_brief_1_0_0";
export const HERO_SLUG = "property-operations-brief-builder";

const heroScenarios = [
  {
    scenario_id: "scenario_maintenance_backlog",
    label: "Maintenance backlog review",
    description:
      "A maintenance coordinator turns a synthetic backlog observation set into a reviewer-ready brief.",
    input_fixture: {
      brief_title: "Northgate maintenance backlog review",
      audience: "Regional maintenance manager",
      observations: [
        "Synthetic: 14 open work orders are older than 30 days.",
        "Synthetic: two chiller repairs are waiting on a vendor quote.",
        "Synthetic: after-hours call volume rose in the last two weeks.",
      ],
      constraints: [
        "Do not infer a resident safety conclusion from this data.",
        "A human must confirm every work-order count before it is shared.",
      ],
    },
    expected_usefulness: [
      "Every supplied observation is preserved verbatim for the reviewer",
      "Each observation produces an explicit reviewer question",
    ],
    expected_safety: [
      "No operational fact is invented or resolved by the asset",
      "The synthetic boundary is preserved in the output",
    ],
    output_schema_expectations: [
      "title, summary, and review_questions are present",
      "limitations are carried into the output",
    ],
  },
  {
    scenario_id: "scenario_energy_variance",
    label: "Energy variance review",
    description:
      "A sustainability analyst reuses the same frozen asset for a different domain and audience without rebuilding the pattern.",
    input_fixture: {
      brief_title: "Lakeside energy variance review",
      audience: "Sustainability analyst",
      observations: [
        "Synthetic: metered consumption exceeded the baseline by 18 percent in August.",
        "Synthetic: two interval-data gaps remain unexplained.",
      ],
      constraints: [
        "Do not attribute the variance to a cause without a verified meter audit.",
      ],
    },
    expected_usefulness: [
      "The same frozen pattern serves a different domain and audience",
      "Missing context is surfaced as a reviewer question rather than filled in",
    ],
    expected_safety: [
      "No cause or savings figure is asserted by the asset",
      "The synthetic boundary is preserved in the output",
    ],
    output_schema_expectations: [
      "title, summary, and review_questions are present",
      "limitations are carried into the output",
    ],
  },
] as const;

const heroContent = AssetVersionContentSchema.parse({
  asset_version_id: HERO_VERSION_ID,
  asset_id: HERO_ASSET_ID,
  version: "1.0.0",
  name: "Property Operations Brief Builder",
  summary:
    "Turns approved property observations into a structured, reviewer-ready operations brief with explicit open questions.",
  owner: "Property Operations Enablement",
  asset_type: "workflow",
  execution_kind: "deterministic",
  description:
    "A deterministic brief builder that preserves every supplied observation verbatim, generates an explicit reviewer question for each one, and carries its limitations into the output. It infers nothing, resolves nothing, and never replaces the human who owns the operational decision.",
  audiences: ["Maintenance coordinators", "Regional operations managers", "Sustainability analysts"],
  domains: ["property operations", "maintenance", "sustainability"],
  capabilities: [
    "structure approved observations into a reviewer-ready brief",
    "generate an explicit review question for every observation",
    "carry constraints and limitations into the output verbatim",
  ],
  use_cases: [
    "prepare a maintenance backlog review brief",
    "prepare an energy variance review brief",
    "standardize recurring operations handoff notes",
  ],
  input_schema: PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
  output_schema: PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
  limitations: [
    "A human reviewer remains responsible for verifying every operational fact.",
    "The asset is deterministic. It does not infer causes, resolve ambiguity, or rank severity.",
    "Use approved, sanitized observations only. It is not a resident, legal, or vendor decision tool.",
  ],
  usage_instructions:
    "Supply a brief title, the audience, one approved observation per line, and any required constraints. Review every generated question before sharing the brief.",
  setup_expectations:
    "No installation or key is required. The executor runs server-side with no network or filesystem access.",
  maintenance_expectations:
    "The owner should re-run both scenarios and refresh review evidence whenever the behavior configuration or limitations change.",
  test_scenarios: heroScenarios,
  availability: "runnable",
  executor_key: PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  definition_digest: PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  source_class: "created_during_event",
  source_reference: "Synthetic event-created hero workflow",
  license_id: null,
  attribution: null,
  permission_evidence_id: null,
  access_permission: "confirmed",
  tool_use_permission: "confirmed",
  final_package_permission: "confirmed",
  created_at: "2026-09-16T08:00:00Z",
});

/** The frozen runnable draft the demo seed promotes through the real gates. */
export const heroDraftRecord: AssetVersionRecord = AssetVersionRecordSchema.parse({
  asset: {
    asset_id: HERO_ASSET_ID,
    slug: HERO_SLUG,
    current_published_version_id: null,
    created_at: "2026-09-16T08:00:00Z",
    updated_at: "2026-09-16T08:00:00Z",
  },
  asset_version: {
    ...heroContent,
    lifecycle: "draft",
    subject_digest: computeSubjectDigest(heroContent),
    published_at: null,
    deprecated_at: null,
    replacement_version: null,
  },
});

export const heroReviewEvidence: DemoEvidencePlan[] = [
  systemMetadata(6),
  sourcePermission(6),
  humanReview(
    "Dana Whitfield",
    "Property operations enablement lead",
    5,
    "Both scenarios produce briefs a regional manager can act on without rebuilding the pattern.",
  ),
  securityReview("Dana Whitfield", "Prepublication security and data-handling reviewer", 5),
];

/**
 * Nine reference contributions with deliberately different governance states,
 * so trust, freshness, and gate coverage are meaningful rather than uniform.
 */
export const demoCatalogEntries: DemoCatalogEntry[] = [
  buildEntry({
    assetId: "asset_turnover_readiness",
    slug: "turnover-readiness-checklist",
    versionId: "av_turnover_readiness_1_0_0",
    version: "1.0.0",
    name: "Turnover Readiness Checklist",
    summary:
      "A unit-turnover checklist that organizes make-ready observations into a single reviewable list before a walk.",
    description:
      "Structures make-ready observations, vendor dependencies, and outstanding punch items so a supervisor can review one list instead of five message threads. It records what is unknown rather than guessing.",
    owner: "Make-Ready Operations",
    assetType: "workflow",
    domains: ["property operations", "maintenance"],
    audiences: ["Maintenance coordinators", "Make-ready supervisors"],
    capabilities: [
      "prepare property operations review notes for a unit turn",
      "group make-ready observations by unit and trade",
      "flag vendor dependencies that block a turn",
      "record unresolved punch items as explicit open questions",
    ],
    useCases: [
      "prepare a property operations review of unit readiness",
      "prepare a unit turnover walk",
      "hand off an in-progress turn between shifts",
    ],
    limitations: [
      "Does not schedule work, dispatch vendors, or commit a move-in date.",
      "Condition and cost fields must be verified on site before they are shared.",
    ],
    usage:
      "Enter one observation per unit, mark the trade, then walk the list with the supervisor before closing the turn.",
    setup: "No installation required. Copy the structure into the team's existing turn tracker.",
    maintenance: "The owner reviews the trade list and blocking conditions each release.",
    inputFields: { unit: { type: "string" }, observations: { type: "array" } },
    outputFields: { readiness_items: { type: "array" }, open_questions: { type: "array" } },
    createdAt: "2026-09-16T09:10:00Z",
    publishedAt: "2026-09-16T10:05:00Z",
    evidence: [
      systemMetadata(20),
      sourcePermission(20),
      humanReview("Priya Raman", "Make-ready operations manager", 18, "The checklist matches the current turn process."),
    ],
  }),

  // Superseded first version: reviewed content that the current version no longer matches.
  buildEntry({
    assetId: "asset_resident_comms",
    slug: "resident-communication-planner",
    versionId: "av_resident_comms_1_0_0",
    version: "1.0.0",
    name: "Resident Communication Planner",
    summary:
      "A planning structure for drafting clear, audience-appropriate resident updates from approved facts.",
    description:
      "Organizes an approved set of facts into a resident-ready update with an explicit tone, audience, and escalation path. Reviewed against the original notice-only scope.",
    owner: "Resident Experience",
    assetType: "template",
    domains: ["resident communications", "property operations"],
    audiences: ["Property managers", "Community managers"],
    capabilities: [
      "structure an approved fact set into a resident notice",
      "state the audience and tone explicitly",
      "record the escalation contact for questions",
    ],
    useCases: ["draft a planned-outage notice", "draft a scheduled-maintenance update"],
    limitations: [
      "Reference-only content. It does not send, schedule, or approve resident communication.",
      "Every fact must be confirmed by the property team before a notice is issued.",
    ],
    usage: "Fill in the approved facts, confirm the audience, then route the draft to the property manager.",
    setup: "No installation required.",
    maintenance: "The owner reviews tone guidance and escalation contacts each release.",
    inputFields: { approved_facts: { type: "array" }, audience: { type: "string" } },
    outputFields: { notice_draft: { type: "string" }, escalation_contact: { type: "string" } },
    createdAt: "2026-09-16T09:00:00Z",
    publishedAt: "2026-09-16T09:40:00Z",
    evidence: [
      systemMetadata(30),
      sourcePermission(30),
      humanReview(
        "Alicia Moreno",
        "Resident experience manager",
        29,
        "Reviewed the notice-only scope, tone guidance, and escalation path.",
      ),
      securityReview("Alicia Moreno", "Prepublication security and data-handling reviewer", 29),
    ],
    current: false,
  }),

  // Current version: content was revised after 1.0.0 was reviewed. Only the
  // deterministic metadata check has been re-run against the new digest.
  buildEntry({
    assetId: "asset_resident_comms",
    slug: "resident-communication-planner",
    versionId: "av_resident_comms_1_1_0",
    version: "1.1.0",
    name: "Resident Communication Planner",
    summary:
      "A planning structure for drafting clear, audience-appropriate resident updates, now including billing and lease-change notices.",
    description:
      "Organizes an approved set of facts into a resident-ready update with an explicit tone, audience, and escalation path. Version 1.1.0 extends the scope beyond operational notices to billing adjustments and lease-change messaging.",
    owner: "Resident Experience",
    assetType: "template",
    domains: ["resident communications", "property operations", "billing"],
    audiences: ["Property managers", "Community managers", "Billing specialists"],
    capabilities: [
      "structure an approved fact set into a resident notice",
      "state the audience and tone explicitly",
      "draft billing-adjustment and lease-change notices",
    ],
    useCases: [
      "draft a planned-outage notice",
      "draft a billing adjustment explanation",
      "draft a lease-change notification",
    ],
    limitations: [
      "Reference-only content. It does not send, schedule, or approve resident communication.",
      "Every fact must be confirmed by the property team before a notice is issued.",
    ],
    usage:
      "Fill in the approved facts, confirm the audience and notice category, then route the draft to the property manager.",
    setup: "No installation required.",
    maintenance: "The owner reviews tone guidance and escalation contacts each release.",
    inputFields: {
      approved_facts: { type: "array" },
      audience: { type: "string" },
      notice_category: { type: "string" },
    },
    outputFields: { notice_draft: { type: "string" }, escalation_contact: { type: "string" } },
    createdAt: "2026-09-16T14:20:00Z",
    publishedAt: "2026-09-16T14:35:00Z",
    evidence: [systemMetadata(3)],
  }),

  buildEntry({
    assetId: "asset_notice_composer",
    slug: "resident-notice-composer",
    versionId: "av_notice_composer_1_0_0",
    version: "1.0.0",
    name: "Resident Notice Composer",
    summary:
      "Composes a resident notice from an approved fact set, with the audience, tone, and escalation contact stated explicitly.",
    description:
      "Takes an approved set of facts and produces a resident-ready notice with a named audience, an explicit tone, and the escalation contact for questions. It covers operational, billing, and lease-change notices, and records which facts were confirmed before the notice was drafted.",
    owner: "Resident Experience",
    assetType: "template",
    domains: ["resident communications", "property operations", "billing"],
    audiences: ["Property managers", "Community managers", "Billing specialists"],
    capabilities: [
      "structure an approved fact set into a resident notice",
      "state the audience and tone explicitly",
      "record the escalation contact for questions",
      "draft billing-adjustment and lease-change notices",
    ],
    useCases: [
      "draft a planned-outage notice",
      "draft a billing adjustment explanation",
      "draft a lease-change notification",
    ],
    limitations: [
      "Reference-only content. It does not send, schedule, or approve resident communication.",
      "Every fact must be confirmed by the property team before a notice is issued.",
      "It does not decide whether a notice is legally required.",
    ],
    usage:
      "Enter the confirmed facts and the notice category, then route the draft to the property manager for approval.",
    setup: "No installation required.",
    maintenance: "The owner reviews tone guidance, categories, and escalation contacts each release.",
    inputFields: {
      approved_facts: { type: "array" },
      audience: { type: "string" },
      notice_category: { type: "string" },
    },
    outputFields: { notice_draft: { type: "string" }, escalation_contact: { type: "string" } },
    createdAt: "2026-09-16T11:00:00Z",
    publishedAt: "2026-09-16T11:30:00Z",
    evidence: [
      systemMetadata(2),
      sourcePermission(2),
      humanReview(
        "Alicia Moreno",
        "Resident experience manager",
        2,
        "Covers the same notice categories as the planner, with the confirmation step made explicit.",
      ),
    ],
  }),

  buildEntry({
    assetId: "asset_vendor_scope",
    slug: "vendor-scope-brief",
    versionId: "av_vendor_scope_1_0_0",
    version: "1.0.0",
    name: "Vendor Scope Brief",
    summary:
      "Turns an approved work description into a reviewable vendor scope with explicit exclusions and acceptance criteria.",
    description:
      "Converts an approved scope of work into a structured brief covering inclusions, exclusions, site access, and acceptance criteria, so two vendors can be compared on the same basis.",
    owner: "Procurement Operations",
    assetType: "template",
    domains: ["procurement", "vendor management"],
    audiences: ["Property operations teams", "Procurement specialists"],
    capabilities: [
      "separate scope inclusions from explicit exclusions",
      "state site-access and scheduling constraints",
      "define acceptance criteria before a bid is requested",
    ],
    useCases: ["prepare a vendor bid package", "compare two vendor proposals on one basis"],
    limitations: [
      "Does not price work, select a vendor, or create a contractual commitment.",
      "Legal and contract terms must be reviewed by the responsible owner.",
    ],
    usage: "Draft the scope, mark exclusions explicitly, then route for procurement review.",
    setup: "No installation required.",
    maintenance: "The owner reviews acceptance-criteria guidance each release.",
    inputFields: { scope_of_work: { type: "string" }, exclusions: { type: "array" } },
    outputFields: { vendor_brief: { type: "string" }, acceptance_criteria: { type: "array" } },
    createdAt: "2026-09-16T09:15:00Z",
    publishedAt: "2026-09-16T10:05:00Z",
    evidence: [
      systemMetadata(16),
      sourcePermission(16),
      humanReview("Grant Ellis", "Procurement operations lead", 15, "Exclusions and acceptance criteria match current practice."),
    ],
  }),

  buildEntry({
    assetId: "asset_lease_abstract",
    slug: "lease-abstract-review",
    versionId: "av_lease_abstract_1_0_0",
    version: "1.0.0",
    name: "Lease Abstract Review Guide",
    summary:
      "A completeness and consistency guide for checking a human-prepared lease abstract before it is relied upon.",
    description:
      "Walks a reviewer through the clauses, dates, and financial terms most often missed in a lease abstract, and records which fields were verified against the source document.",
    owner: "Lease Administration",
    assetType: "skill",
    domains: ["lease administration", "compliance"],
    audiences: ["Implementation specialists", "Lease administrators"],
    capabilities: [
      "check required clauses and critical dates for completeness",
      "record which fields were verified against the source lease",
      "surface inconsistencies between abstract and source",
    ],
    useCases: ["review a newly prepared lease abstract", "spot-check an abstract before migration"],
    limitations: [
      "Not legal advice and not a substitute for counsel review.",
      "Does not read, parse, or interpret the underlying lease document.",
    ],
    usage: "Work through each section against the source lease and record every verified field.",
    setup: "No installation required. Requires access to the source lease document.",
    maintenance: "The owner reviews the clause list whenever lease templates change.",
    inputFields: { abstract_fields: { type: "object" } },
    outputFields: { verification_log: { type: "array" }, inconsistencies: { type: "array" } },
    createdAt: "2026-09-16T09:20:00Z",
    publishedAt: "2026-09-16T10:05:00Z",
    evidence: [systemMetadata(22), sourcePermission(22)],
  }),

  buildEntry({
    assetId: "asset_energy_review",
    slug: "energy-review-canvas",
    versionId: "av_energy_review_1_0_0",
    version: "1.0.0",
    name: "Energy Review Canvas",
    summary:
      "A worksheet for comparing utility observations against a baseline and recording unexplained interval gaps.",
    description:
      "Lays out metered consumption, baseline, weather normalization notes, and missing intervals side by side so an analyst can separate a data problem from a building problem.",
    owner: "Sustainability Analytics",
    assetType: "dashboard",
    domains: ["sustainability", "utilities"],
    audiences: ["Sustainability analysts", "Asset managers"],
    capabilities: [
      "compare metered consumption against a stated baseline",
      "record unexplained interval gaps explicitly",
      "separate data-quality issues from building performance",
    ],
    useCases: ["run a monthly utility variance review", "prepare an energy audit input pack"],
    limitations: [
      "Does not attribute a cause, model savings, or produce a verified energy figure.",
      "Requires a stated baseline; it does not derive one.",
    ],
    usage: "Load the observations and baseline, then record every gap before drawing a conclusion.",
    setup: "No installation required. Bring exported interval data.",
    maintenance: "The owner reviews baseline guidance each reporting cycle.",
    inputFields: { consumption: { type: "array" }, baseline: { type: "number" } },
    outputFields: { variance_summary: { type: "array" }, data_gaps: { type: "array" } },
    createdAt: "2026-09-16T09:25:00Z",
    publishedAt: "2026-09-16T10:05:00Z",
    evidence: [
      systemMetadata(12),
      sourcePermission(12),
      humanReview("Noor Haddad", "Sustainability analytics lead", 11, "Baseline handling and gap recording match the audit process."),
    ],
  }),

  buildEntry({
    assetId: "asset_capex_intake",
    slug: "capex-intake-template",
    versionId: "av_capex_intake_1_0_0",
    version: "1.0.0",
    name: "Capital Project Intake Template",
    summary:
      "An intake structure for collecting capital project context, constraints, dependencies, and the named decision owner.",
    description:
      "Captures the project driver, constraints, dependencies, and decision owner at intake, so a capital request arrives complete instead of being reconstructed later.",
    owner: "Capital Planning",
    assetType: "template",
    domains: ["capital planning", "asset management"],
    audiences: ["Asset managers", "Regional directors"],
    capabilities: [
      "capture the project driver and constraints at intake",
      "record cross-project dependencies",
      "name the decision owner before review",
    ],
    useCases: ["submit a capital project request", "prepare a capital review agenda item"],
    limitations: [
      "Does not approve funding, prioritize projects, or produce a financial model.",
      "Cost figures are inputs to review, not validated estimates.",
    ],
    usage: "Complete every field at intake and name the decision owner before submitting.",
    setup: "No installation required.",
    maintenance: "The owner reviews the field list each planning cycle.",
    inputFields: { project_driver: { type: "string" }, constraints: { type: "array" } },
    outputFields: { intake_record: { type: "object" }, decision_owner: { type: "string" } },
    createdAt: "2026-09-16T09:30:00Z",
    publishedAt: "2026-09-16T10:05:00Z",
    evidence: [
      systemMetadata(9),
      sourcePermission(9),
      humanReview("Tomas Berg", "Capital planning manager", 8, "Intake fields match the current capital review packet."),
    ],
  }),

  buildEntry({
    assetId: "asset_service_recovery",
    slug: "service-recovery-brief",
    versionId: "av_service_recovery_1_0_0",
    version: "1.0.0",
    name: "Service Recovery Brief",
    summary:
      "A human-led brief format for organizing service issue facts, customer impact, and follow-up ownership.",
    description:
      "Separates confirmed facts from open questions during a service escalation and assigns explicit follow-up ownership, so a recovery conversation is grounded rather than improvised.",
    owner: "Customer Experience",
    assetType: "workflow",
    domains: ["customer experience", "service recovery"],
    audiences: ["Regional operations leaders", "Customer experience managers"],
    capabilities: [
      "separate confirmed facts from open questions",
      "state customer impact in plain language",
      "assign explicit follow-up ownership and timing",
    ],
    useCases: ["prepare a service escalation review", "hand off an open recovery case"],
    limitations: [
      "Does not make or communicate a customer remedy, credit, or commitment.",
      "Impact statements must be confirmed with the account owner before use.",
    ],
    usage: "Record only confirmed facts, list every open question, then assign follow-up owners.",
    setup: "No installation required.",
    maintenance: "The owner reviews escalation routing each quarter.",
    inputFields: { confirmed_facts: { type: "array" }, open_questions: { type: "array" } },
    outputFields: { recovery_brief: { type: "string" }, follow_ups: { type: "array" } },
    createdAt: "2026-09-16T09:35:00Z",
    publishedAt: "2026-09-16T10:05:00Z",
    evidence: [
      systemMetadata(26),
      humanReview("Renata Cruz", "Customer experience director", 25, "The fact-versus-question split matches escalation practice."),
    ],
  }),

  buildEntry({
    assetId: "asset_portfolio_review",
    slug: "portfolio-review-agenda",
    versionId: "av_portfolio_review_1_0_0",
    version: "1.0.0",
    name: "Portfolio Review Agenda",
    summary:
      "A repeatable agenda and notes structure for portfolio operating reviews with explicit evidence gaps.",
    description:
      "Gives a portfolio operating review a fixed agenda, a place for the numbers actually reviewed, and a standing section for evidence the team could not produce in time.",
    owner: "Portfolio Operations",
    assetType: "template",
    domains: ["portfolio management", "operations review"],
    audiences: ["Portfolio managers", "Regional directors"],
    capabilities: [
      "run a consistent operating review agenda",
      "record which figures were actually reviewed",
      "carry unresolved evidence gaps to the next review",
    ],
    useCases: ["run a monthly portfolio operating review", "prepare a quarterly business review"],
    limitations: [
      "Does not compute portfolio metrics or validate reported figures.",
      "Carried-forward gaps require an owner; the template does not assign one.",
    ],
    usage: "Use the fixed agenda, record the figures reviewed, and carry every unresolved gap forward.",
    setup: "No installation required.",
    maintenance: "The owner refreshes the agenda whenever the review cadence changes.",
    inputFields: { review_period: { type: "string" }, metrics_reviewed: { type: "array" } },
    outputFields: { agenda: { type: "array" }, evidence_gaps: { type: "array" } },
    createdAt: "2026-09-16T09:40:00Z",
    publishedAt: "2026-09-16T10:05:00Z",
    evidence: [
      systemMetadata(96),
      sourcePermission(96),
      humanReview("Iris Kovacs", "Portfolio operations lead", 95, "Agenda and gap handling match the operating review."),
    ],
  }),
];

/** Backwards-compatible export used by existing seed and discovery tests. */
export const publishedCatalogFixtures: AssetVersionRecord[] = demoCatalogEntries.map(
  (entry) => entry.record,
);

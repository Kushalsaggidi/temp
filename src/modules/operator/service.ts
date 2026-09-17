import { randomUUID } from "node:crypto";

import type {
  AssetVersionRecord,
  OperatorActionRequest,
  OperatorBlock,
  OperatorContext,
  OperatorRequest,
  OperatorResponse,
  OperatorSuggestion,
  OperatorTraceEntry,
  OperatorUnderstanding,
} from "@/contracts";
import { OperatorResponseSchema } from "@/contracts";
import type { MarketplaceDatabase } from "@/server/db/connection";

import { GeminiOperatorAdapter, type ContributionDraftOutput } from "./ai";
import { composeBlocks, suggestionsFor } from "./compose";
import {
  contributionPlan,
  deterministicDraft,
  prepareForReviewPlan,
  wantsPrepareForReview,
} from "./plans";
import { resolveAsset, type ResolvedAsset } from "./resolve";
import { routeDeterministically } from "./router";
import { closeDatabase, openDatabase } from "@/server/db/connection";
import { migrateDatabase } from "@/server/db/migrate";

import { listPublishedRecords, loadSnapshot, toAssetCard } from "./state";
import { rankByText } from "./resolve";
import {
  findTool,
  TOOLS,
  type ContributionDraftFields,
  type OperatorPayload,
  type ToolArgs,
  type ToolContext,
  type ToolOutcome,
} from "./tools";

export interface OperatorOptions {
  adapter?: GeminiOperatorAdapter;
  now?: Date;
  databasePath?: string;
}

function requestId(): string {
  return `op_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function trace(
  tool: string,
  kind: "read" | "write",
  status: "ok" | "error" | "skipped",
  detail: string,
  start: number,
): OperatorTraceEntry {
  return {
    tool,
    kind,
    status,
    detail,
    duration_ms: Math.max(0, Math.round(Date.now() - start)),
  };
}

function aiState(
  reason: string | null,
  model: string | null,
): OperatorResponse["ai"] {
  if (model !== null) {
    return { state: "ready", model_or_config: model, reason: null };
  }
  if (reason === null) {
    return {
      state: "not_needed",
      model_or_config: null,
      reason:
        "The deterministic router matched this request exactly, so no model call was made.",
    };
  }
  return {
    state: reason.includes("disabled") ? "disabled" : "unavailable",
    model_or_config: null,
    reason,
  };
}

function draftFromModel(
  output: ContributionDraftOutput,
  owner: string,
  isAgent: boolean,
): ContributionDraftFields {
  return {
    slug: output.slug,
    name: output.name,
    summary: output.summary,
    owner,
    asset_type: isAgent ? "agent" : "template",
    version: "1.0.0",
    description: output.description,
    capabilities: output.capabilities,
    use_cases: output.use_cases,
    domains: output.domains,
    audiences: output.audiences,
    limitations: output.limitations,
    usage_instructions: output.usage_instructions,
    setup_expectations: output.setup_expectations,
    maintenance_expectations: output.maintenance_expectations,
  };
}

/**
 * Turns a request into the capability that answers it. The deterministic
 * router handles the phrasings the product documents; the model is asked only
 * when that router is unsure, and a model answer that names an unknown tool is
 * discarded rather than trusted.
 */
async function decideRoute(
  utterance: string,
  context: OperatorContext,
  adapter: GeminiOperatorAdapter,
  published: AssetVersionRecord[],
): Promise<{
  tool: string;
  intent: string;
  interpretation: string;
  confidence: "high" | "medium" | "low";
  assetReference: string | null;
  secondReference: string | null;
  query: string;
  args: ToolArgs;
  routedBy: "deterministic" | "model";
  aiReason: string | null;
  model: string | null;
}> {
  const deterministic = routeDeterministically(utterance, context);
  const base = deterministic ?? {
    tool: "searchAssets",
    intent: "search",
    interpretation: "Read as a catalogue search over published assets.",
    confidence: "low" as const,
    assetReference: null,
    secondReference: null,
    query: utterance,
    args: {} as ToolArgs,
  };

  if (base.confidence === "high") {
    return { ...base, routedBy: "deterministic", aiReason: null, model: null };
  }

  const result = await adapter.route({
    utterance,
    surface: context.surface,
    contextLabel: context.label,
    contextAssetName: context.asset_name,
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      kind: tool.kind,
      summary: tool.summary,
    })),
    candidates: published.slice(0, 40).map((record) => ({
      asset_version_id: record.asset_version.asset_version_id,
      name: record.asset_version.name,
    })),
  });

  if (result.state !== "ready" || findTool(result.output.tool) === null) {
    return {
      ...base,
      routedBy: "deterministic",
      aiReason:
        result.state === "ready"
          ? "The routing service named a capability that does not exist; the deterministic router is used."
          : result.reason,
      model: null,
    };
  }

  const route = result.output;
  return {
    tool: route.tool,
    intent: route.intent,
    interpretation: route.interpretation,
    confidence: "medium",
    assetReference: route.asset_reference.trim() || base.assetReference,
    secondReference: route.second_asset_reference.trim() || base.secondReference,
    query: route.query.trim() || base.query,
    args: base.args,
    routedBy: "model",
    aiReason: null,
    model: result.modelOrConfig,
  };
}

async function buildDraft(
  utterance: string,
  adapter: GeminiOperatorAdapter,
  published: AssetVersionRecord[],
): Promise<{ draft: ContributionDraftFields | null; aiAssisted: boolean; note: string | null }> {
  const fallback = deterministicDraft(utterance);
  const domains = [
    ...new Set(published.flatMap((record) => record.asset_version.domains)),
  ];
  const result = await adapter.draftContribution(utterance, domains);

  if (result.state !== "ready") {
    return {
      draft: fallback,
      aiAssisted: false,
      note:
        fallback === null
          ? null
          : `${result.reason} The fields below were filled in from your own wording and are placeholders you should replace.`,
    };
  }

  return {
    draft: draftFromModel(
      result.output,
      "Marketplace contributor",
      /\bagent\b/i.test(utterance),
    ),
    aiAssisted: true,
    note: "The metadata below is a model-written draft from your description. Nothing has been created, and a person reviews every field before this can be published.",
  };
}

function contributionOutcome(
  draft: ContributionDraftFields,
  aiAssisted: boolean,
  note: string | null,
  database: MarketplaceDatabase,
): OperatorPayload {
  const duplicates = rankByText(
    listPublishedRecords(database),
    [draft.name, draft.summary, ...draft.capabilities].join(". "),
  )
    .filter((candidate) => candidate.score > 0.1)
    .slice(0, 3)
    .map((candidate) =>
      toAssetCard(candidate.record, { matchedFields: candidate.matchedFields }),
    );

  return {
    type: "contribution",
    draft,
    duplicates,
    aiAssisted,
    aiNote: note,
  };
}

/* ------------------------------------------------------------------ *
 * Entry points.
 * ------------------------------------------------------------------ */

export async function runOperator(
  request: OperatorRequest,
  options: OperatorOptions = {},
): Promise<OperatorResponse> {
  const now = options.now ?? new Date();
  const adapter = options.adapter ?? new GeminiOperatorAdapter();
  const utterance = request.utterance.trim();
  const context = request.context;

  const database = openScope(options.databasePath);
  try {
    const published = listPublishedRecords(database.handle);
    const route = await decideRoute(utterance, context, adapter, published);

    const definition = findTool(route.tool);
    const wantsAsset =
      (definition?.needsAsset ?? false) || (definition?.usesAsset ?? false);
    const resolved: ResolvedAsset | null = wantsAsset
      ? resolveAsset(
          database.handle,
          route.assetReference,
          context,
          request.focus_asset_version_id ?? null,
        )
      : null;

    // On the compare surface the two subjects are already on screen, so
    // "compare these two" needs no names.
    const comparePair =
      route.tool === "compareAssets" && context.compare_ids.length >= 2
        ? context.compare_ids
        : null;

    const second =
      !wantsAsset
        ? null
        : comparePair !== null && route.secondReference === null
          ? resolveAsset(database.handle, comparePair[1]!, context)
          : route.secondReference === null
            ? null
            : resolveAsset(database.handle, route.secondReference, {
                ...context,
                asset_version_id: null,
                asset_name: null,
              });

    const understanding: OperatorUnderstanding = {
      intent: route.intent,
      tool: route.tool,
      kind: findTool(route.tool)?.kind ?? null,
      confidence: route.confidence,
      interpretation: route.interpretation,
      routed_by: route.routedBy,
      resolved_asset:
        resolved === null
          ? null
          : {
              asset_version_id: resolved.record.asset_version.asset_version_id,
              name: resolved.record.asset_version.name,
              how: resolved.how,
            },
    };

    const traces: OperatorTraceEntry[] = [];
    const blocks: OperatorBlock[] = [];
    let suggestions: OperatorSuggestion[] = [];

    // A contribution is always a plan, never a single silent write.
    if (route.tool === "createAsset") {
      const started = Date.now();
      const { draft, aiAssisted, note } = await buildDraft(utterance, adapter, published);
      if (draft === null) {
        blocks.push({
          kind: "blocked",
          title: "Tell me what you want to contribute",
          reason: "I could not work out what the asset is from that wording.",
          detail: ["Try: \"I want to contribute a fraud detection agent\"."],
          links: [{ label: "Contribution form", href: "/contribute" }],
          suggestions: [],
        });
        traces.push(trace("createAsset", "write", "skipped", "no draft could be built", started));
      } else {
        const payload = contributionOutcome(draft, aiAssisted, note, database.handle);
        blocks.push(...composeBlocks(payload, now));
        blocks.push({ kind: "plan", plan: contributionPlan(draft, now) });
        suggestions = suggestionsFor(payload, context);
        traces.push(
          trace(
            "createAsset",
            "write",
            "ok",
            `draft prepared (${aiAssisted ? "model-assisted" : "deterministic"}); nothing written`,
            started,
          ),
        );
      }
      return finish(request, understanding, blocks, suggestions, traces, route, now);
    }

    // "Prepare it for review" over an existing draft is also a plan.
    if (
      wantsPrepareForReview(utterance) &&
      resolved !== null &&
      ["draft", "changes_requested"].includes(resolved.record.asset_version.lifecycle)
    ) {
      const started = Date.now();
      const snapshot = loadSnapshot(
        database.handle,
        resolved.record.asset_version.asset_version_id,
        now,
      );
      const plan = prepareForReviewPlan(
        resolved.record.asset_version.asset_version_id,
        resolved.record.asset_version.name,
        snapshot?.record.asset_version.subject_digest !== null,
        now,
      );
      blocks.push({
        kind: "headline",
        eyebrow: "Plan",
        title: plan.title,
        detail: `${plan.steps.length} steps. Nothing runs until you execute the plan, and the final step asks again before it changes anything.`,
        tone: "brand",
      });
      blocks.push({ kind: "plan", plan });
      traces.push(trace("plan", "read", "ok", `${plan.steps.length} steps planned`, started));
      return finish(request, understanding, blocks, suggestions, traces, route, now);
    }

    const tool = findTool(route.tool);
    if (tool === null) {
      blocks.push({
        kind: "blocked",
        title: "I do not have a capability for that",
        reason: `There is no registered tool named ${route.tool}.`,
        detail: [],
        links: [],
        suggestions: [],
      });
      return finish(request, understanding, blocks, suggestions, traces, route, now);
    }

    const toolContext: ToolContext = {
      database: database.handle,
      now,
      context,
      asset: resolved?.record ?? null,
      secondAsset: second?.record ?? null,
      query: route.query,
      utterance,
    };

    const started = Date.now();
    let outcome: ToolOutcome;
    try {
      outcome = await tool.run(route.args, toolContext);
    } catch (error) {
      outcome = {
        ok: false,
        summary: "the capability failed",
        payload: {
          type: "blocked",
          title: "That did not complete",
          reason:
            error instanceof Error && error.message
              ? error.message
              : "The capability could not be completed. Nothing was changed.",
          detail: [],
          links: [],
        },
      };
    }
    traces.push(
      trace(tool.name, tool.kind, outcome.ok ? "ok" : "error", outcome.summary, started),
    );

    try {
      blocks.push(...composeBlocks(outcome.payload, now));
      suggestions = suggestionsFor(outcome.payload, context);
    } catch (error) {
      console.error("[operator] composing the answer failed", error);
      blocks.push({
        kind: "blocked",
        title: "I could not present that result",
        reason:
          "The capability ran, but its result could not be assembled into a view. Nothing was changed.",
        detail: error instanceof Error && error.message ? [error.message] : [],
        links: [],
        suggestions: [],
      });
    }

    // Only a genuinely different asset is worth offering as another reading;
    // another version of the same asset is not an alternative interpretation.
    const otherAssets = (resolved?.others ?? []).filter(
      (other) => other.asset.asset_id !== resolved?.record.asset.asset_id,
    );
    if (resolved !== null && otherAssets.length > 0 && resolved.confidence !== "high") {
      blocks.push({
        kind: "note",
        text: `I read that as ${resolved.record.asset_version.name}. Other close matches: ${otherAssets.map((other) => other.asset_version.name).join(", ")}.`,
        tone: "neutral",
      });
    }

    return finish(request, understanding, blocks, suggestions, traces, route, now);
  } finally {
    database.close();
  }
}

/** Builds the preview for one write tool without performing anything. */
export async function previewOperatorAction(
  tool: string,
  args: ToolArgs,
  context: OperatorContext,
  options: OperatorOptions = {},
): Promise<OperatorResponse> {
  const now = options.now ?? new Date();
  const definition = findTool(tool);
  const database = openScope(options.databasePath);
  try {
    if (definition === null) {
      return unknownToolResponse(tool, context, now);
    }
    const asset = resolveTarget(database.handle, args, context);
    const outcome = await definition.run(args, {
      database: database.handle,
      now,
      context,
      asset,
      secondAsset: null,
      query: "",
      utterance: `${definition.name}`,
    });
    return finish(
      {
        utterance: definition.name,
        context,
      },
      {
        intent: definition.name,
        tool: definition.name,
        kind: definition.kind,
        confidence: "high",
        interpretation: definition.summary,
        routed_by: "deterministic",
        resolved_asset:
          asset === null
            ? null
            : {
                asset_version_id: asset.asset_version.asset_version_id,
                name: asset.asset_version.name,
                how: "Named directly by the action.",
              },
      },
      composeBlocks(outcome.payload, now),
      [],
      [trace(definition.name, definition.kind, outcome.ok ? "ok" : "error", outcome.summary, Date.now())],
      { routedBy: "deterministic", aiReason: null, model: null },
      now,
    );
  } finally {
    database.close();
  }
}

/**
 * Performs one confirmed write, then re-reads the resulting state before
 * reporting anything. A write never reports success it has not verified.
 */
export async function executeOperatorAction(
  request: OperatorActionRequest,
  options: OperatorOptions = {},
): Promise<OperatorResponse> {
  const now = options.now ?? new Date();
  const definition = findTool(request.tool);
  const database = openScope(options.databasePath);
  try {
    if (definition === null) {
      return unknownToolResponse(request.tool, request.context, now);
    }
    if (definition.kind !== "write" || definition.execute === undefined) {
      return unknownToolResponse(request.tool, request.context, now);
    }
    if (!definition.available) {
      return finish(
        { utterance: definition.name, context: request.context },
        {
          intent: definition.name,
          tool: definition.name,
          kind: "write",
          confidence: "high",
          interpretation: definition.summary,
          routed_by: "deterministic",
          resolved_asset: null,
        },
        [
          {
            kind: "blocked",
            title: "That capability is not available",
            reason: definition.unavailableReason ?? "This capability is not implemented.",
            detail: [],
            links: [],
            suggestions: [],
          },
        ],
        [],
        [trace(definition.name, "write", "skipped", "capability unavailable", Date.now())],
        { routedBy: "deterministic", aiReason: null, model: null },
        now,
      );
    }

    const asset = resolveTarget(database.handle, request.args, request.context);
    const started = Date.now();
    let outcome: ToolOutcome;
    try {
      outcome = await definition.execute(request.args, {
        database: database.handle,
        now,
        context: request.context,
        asset,
        secondAsset: null,
        query: "",
        utterance: definition.name,
      });
    } catch (error) {
      outcome = {
        ok: false,
        summary: "the write failed",
        payload: {
          type: "blocked",
          title: "Nothing was changed",
          reason:
            error instanceof Error && error.message
              ? error.message
              : "The operation failed before anything was written.",
          detail: [],
          links: [],
        },
      };
    }

    return finish(
      { utterance: definition.name, context: request.context },
      {
        intent: definition.name,
        tool: definition.name,
        kind: "write",
        confidence: "high",
        interpretation: definition.summary,
        routed_by: "deterministic",
        resolved_asset:
          asset === null
            ? null
            : {
                asset_version_id: asset.asset_version.asset_version_id,
                name: asset.asset_version.name,
                how: "Named directly by the confirmed action.",
              },
      },
      composeBlocks(outcome.payload, now),
      suggestionsFor(outcome.payload, request.context),
      [trace(definition.name, "write", outcome.ok ? "ok" : "error", outcome.summary, started)],
      { routedBy: "deterministic", aiReason: null, model: null },
      now,
    );
  } finally {
    database.close();
  }
}

/* ------------------------------------------------------------------ *
 * Internals.
 * ------------------------------------------------------------------ */

function resolveTarget(
  database: MarketplaceDatabase,
  args: ToolArgs,
  context: OperatorContext,
): AssetVersionRecord | null {
  const explicit =
    typeof args.asset_version_id === "string" ? args.asset_version_id : null;
  const resolved = resolveAsset(database, explicit, context, null);
  return resolved?.record ?? null;
}

function unknownToolResponse(
  tool: string,
  context: OperatorContext,
  now: Date,
): OperatorResponse {
  return finish(
    { utterance: tool, context },
    {
      intent: "unknown capability",
      tool: null,
      kind: null,
      confidence: "low",
      interpretation: "No registered capability matches that name.",
      routed_by: "deterministic",
      resolved_asset: null,
    },
    [
      {
        kind: "blocked",
        title: "I do not have a capability for that",
        reason: `There is no registered tool named ${tool}.`,
        detail: [],
        links: [],
        suggestions: [],
      },
    ],
    [],
    [],
    { routedBy: "deterministic", aiReason: null, model: null },
    now,
  );
}

function finish(
  request: { utterance: string; context: OperatorContext },
  understanding: OperatorUnderstanding,
  blocks: OperatorBlock[],
  suggestions: OperatorSuggestion[],
  traces: OperatorTraceEntry[],
  route: { routedBy: "deterministic" | "model"; aiReason: string | null; model: string | null },
  now: Date,
): OperatorResponse {
  const envelope = {
    request_id: requestId(),
    generated_at: now.toISOString(),
    utterance: request.utterance,
    context_label: request.context.label,
    understanding,
    suggestions,
    trace: traces,
    ai: aiState(route.aiReason, route.model),
  };

  const fallbackBlock: OperatorBlock = {
    kind: "headline",
    eyebrow: null,
    title: "Nothing to show",
    detail: "The capability returned no result.",
    tone: "neutral",
  };

  const parsed = OperatorResponseSchema.safeParse({
    ...envelope,
    blocks: blocks.length > 0 ? blocks : [fallbackBlock],
  });
  if (parsed.success) return parsed.data;

  // A block the renderer cannot accept is a defect in composition, not in the
  // data. Say so plainly and keep the turn usable rather than failing the whole
  // request: the capability already ran and its result is described in the trace.
  console.error(
    "[operator] a composed block did not satisfy the response contract",
    parsed.error.issues,
  );
  return OperatorResponseSchema.parse({
    ...envelope,
    blocks: [
      {
        kind: "blocked",
        title: "I could not present that result",
        reason:
          "The capability ran, but its result could not be assembled into a view. Nothing was changed.",
        detail: parsed.error.issues
          .slice(0, 4)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        links: [],
        suggestions: [],
      },
    ],
  });
}

interface DatabaseScope {
  handle: MarketplaceDatabase;
  close(): void;
}

/**
 * The operator holds one connection for a whole turn, so a write can be
 * re-read through the same handle before anything is reported.
 */
function openScope(path?: string): DatabaseScope {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
  } catch (error) {
    closeDatabase(database);
    throw error;
  }
  return { handle: database, close: () => closeDatabase(database) };
}

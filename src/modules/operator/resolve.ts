import type { AssetVersionRecord, OperatorContext } from "@/contracts";
import { normalizeIntent, retrievePublished } from "@/modules/discovery";
import type { MarketplaceDatabase } from "@/server/db/connection";

import { listAllRecords, listPublishedRecords } from "./state";

export interface ResolvedAsset {
  record: AssetVersionRecord;
  /** How the reference was resolved, shown to the user so nothing is magic. */
  how: string;
  confidence: "high" | "medium" | "low";
  /** Other plausible readings, so an ambiguous reference can be corrected. */
  others: AssetVersionRecord[];
}

/** Words that mean "the thing I am already looking at". */
const DEICTIC =
  /^(this|it|that|the asset|this asset|this one|the current asset|here|current)$/i;

function isIdentifier(value: string): boolean {
  return /^av_[a-z0-9_]+$/.test(value.trim());
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function byIdentifier(
  records: readonly AssetVersionRecord[],
  id: string,
): AssetVersionRecord | null {
  return (
    records.find((record) => record.asset_version.asset_version_id === id.trim()) ?? null
  );
}

/**
 * When several versions of one asset match a name, the version people would
 * actually receive is the right answer. Drafts and deprecated versions rank
 * last so "the Brief Builder" never resolves to an abandoned draft.
 */
const VERSION_PRIORITY: Record<string, number> = {
  published: 0,
  in_review: 2,
  submitted: 3,
  changes_requested: 4,
  draft: 5,
  deprecated: 6,
};

function preference(record: AssetVersionRecord): number {
  const version = record.asset_version;
  if (
    version.lifecycle === "published" &&
    version.deprecated_at === null &&
    record.asset.current_published_version_id === version.asset_version_id
  ) {
    return -1;
  }
  return VERSION_PRIORITY[version.lifecycle] ?? 7;
}

function preferred(records: readonly AssetVersionRecord[]): AssetVersionRecord[] {
  return [...records].sort((left, right) => preference(left) - preference(right));
}

function byName(
  records: readonly AssetVersionRecord[],
  reference: string,
): AssetVersionRecord[] {
  const needle = normalize(reference);
  if (needle.length < 3) return [];
  const exact = records.filter(
    (record) => normalize(record.asset_version.name) === needle,
  );
  if (exact.length > 0) return preferred(exact);
  const contains = records.filter((record) => {
    const name = normalize(record.asset_version.name);
    return name.includes(needle) || needle.includes(name);
  });
  if (contains.length > 0) return preferred(contains);

  // Fall back to token overlap so "reconciliation agent" still finds the asset.
  const tokens = needle.split(" ").filter((token) => token.length > 3);
  if (tokens.length === 0) return [];
  const scored = records
    .map((record) => {
      const name = normalize(record.asset_version.name);
      const hits = tokens.filter((token) => name.includes(token)).length;
      return { record, hits };
    })
    .filter((entry) => entry.hits > 0)
    .sort(
      (left, right) =>
        right.hits - left.hits || preference(left.record) - preference(right.record),
    );
  return scored.map((entry) => entry.record);
}

/** Ranks published assets for a free-text reference using the discovery ranker. */
export function rankByText(
  published: readonly AssetVersionRecord[],
  text: string,
): { record: AssetVersionRecord; score: number; matchedFields: string[] }[] {
  const trimmed = text.trim();
  if (trimmed.length < 3) return [];
  const intent = normalizeIntent({ query: trimmed.slice(0, 1_000) });
  const first = intent.intents[0];
  if (!first) return [];
  return retrievePublished([...published], first, {})
    .filter((candidate) => candidate.score > 0)
    .map((candidate) => ({
      record: candidate.record,
      score: candidate.score,
      matchedFields: [...new Set(candidate.evidence.map((item) => item.field))],
    }));
}

/**
 * Resolves the asset a request is about, in this order: an explicit identifier,
 * the asset already on screen for a deictic reference, an exact or partial name,
 * then the discovery ranker. A request made while viewing an asset never has to
 * ask which asset was meant.
 */
export function resolveAsset(
  database: MarketplaceDatabase,
  reference: string | null,
  context: OperatorContext,
  focusAssetVersionId?: string | null,
): ResolvedAsset | null {
  const all = listAllRecords(database);
  const published = listPublishedRecords(database);
  const trimmed = (reference ?? "").trim();

  if (trimmed.length > 0 && isIdentifier(trimmed)) {
    const record = byIdentifier(all, trimmed);
    if (record !== null) {
      return {
        record,
        how: "Matched the asset version identifier you gave.",
        confidence: "high",
        others: [],
      };
    }
  }

  const contextId = context.asset_version_id ?? focusAssetVersionId ?? null;
  const deictic = trimmed.length === 0 || DEICTIC.test(trimmed);
  if (deictic && contextId !== null) {
    const record = byIdentifier(all, contextId);
    if (record !== null) {
      return {
        record,
        how:
          context.asset_version_id === contextId
            ? `Used the asset open on this page: ${record.asset_version.name}.`
            : `Kept the asset from your previous request: ${record.asset_version.name}.`,
        confidence: "high",
        others: [],
      };
    }
  }

  if (trimmed.length > 0) {
    const named = byName(all, trimmed);
    if (named.length > 0) {
      const [first, ...rest] = named;
      return {
        record: first!,
        how: `Matched "${trimmed}" to ${first!.asset_version.name} by name.`,
        confidence: rest.length === 0 ? "high" : "medium",
        others: rest.slice(0, 3),
      };
    }

    const ranked = rankByText(published, trimmed);
    if (ranked.length > 0) {
      const [first, ...rest] = ranked;
      return {
        record: first!.record,
        how: `Ranked "${trimmed}" against published assets; ${first!.record.asset_version.name} matched on ${first!.matchedFields.slice(0, 3).join(", ") || "catalogue text"}.`,
        confidence: first!.score > 0.4 ? "medium" : "low",
        others: rest.slice(0, 3).map((entry) => entry.record),
      };
    }
  }

  if (contextId !== null) {
    const record = byIdentifier(all, contextId);
    if (record !== null) {
      return {
        record,
        how: `No asset matched that wording, so the asset in context was used: ${record.asset_version.name}.`,
        confidence: "low",
        others: [],
      };
    }
  }

  return null;
}

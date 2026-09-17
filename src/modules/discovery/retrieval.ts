import type { AssetVersionRecord } from "@/contracts";
import type { InterpretedIntentItem } from "./normalization";
import { intentTerms, normalizeTerms } from "./normalization";

export type SearchableField =
  | "capabilities"
  | "domains"
  | "audiences"
  | "input_schema"
  | "output_schema"
  | "use_cases"
  | "description";

export type FieldEvidence = {
  field: SearchableField;
  catalogValue: string;
  matchedTerms: string[];
  semanticTerms: string[];
};

export type RetrievedCandidate = {
  record: AssetVersionRecord;
  score: number;
  evidence: FieldEvidence[];
};

export const DISCOVERY_MATCH_THRESHOLD = 0.12;

const FIELD_WEIGHTS: Readonly<Record<SearchableField, number>> = {
  capabilities: 0.3,
  domains: 0.24,
  audiences: 0.18,
  input_schema: 0.12,
  output_schema: 0.12,
  use_cases: 0.2,
  description: 0.1,
};

const JSON_SCHEMA_NOISE = new Set([
  "$schema", "type", "properties", "required", "items", "additionalProperties",
  "minItems", "maxItems", "minLength", "maxLength", "format", "enum", "const",
]);

function schemaTerms(value: unknown, key?: string): string[] {
  if (typeof value === "string") {
    return key === "title" || key === "description" ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => schemaTerms(item));
  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value).flatMap(([childKey, childValue]) => [
    ...(JSON_SCHEMA_NOISE.has(childKey) ? [] : [childKey.replaceAll("_", " ")]),
    ...schemaTerms(childValue, childKey),
  ]);
}

function searchableValues(record: AssetVersionRecord): Record<SearchableField, string[]> {
  const version = record.asset_version;
  return {
    capabilities: version.capabilities,
    domains: version.domains,
    audiences: version.audiences,
    input_schema: schemaTerms(version.input_schema),
    output_schema: schemaTerms(version.output_schema),
    use_cases: version.use_cases,
    description: [version.name, version.summary, version.description],
  };
}

function qualifies(score: number, evidence: FieldEvidence[]): boolean {
  if (score < DISCOVERY_MATCH_THRESHOLD) return false;

  const highSignal = new Set<SearchableField>([
    "capabilities", "domains", "audiences", "use_cases",
  ]);
  const baseHighSignal = evidence.some(
    (item) => highSignal.has(item.field) && item.matchedTerms.length > 0,
  );
  const detailedBaseEvidence = evidence.some(
    (item) => item.matchedTerms.length >= 2,
  );
  const semanticHighSignalTerms = new Set(
    evidence
      .filter((item) => highSignal.has(item.field))
      .flatMap((item) => item.semanticTerms),
  );

  // Semantic-only expansion is deliberately stricter than lexical matching.
  return baseHighSignal || detailedBaseEvidence || semanticHighSignalTerms.size >= 2;
}

export function retrievePublished(
  records: AssetVersionRecord[],
  intent: InterpretedIntentItem,
  options: { audience?: string; semanticTerms?: string[] } = {},
): RetrievedCandidate[] {
  const baseTerms = intentTerms(intent);
  const domainTerms = normalizeTerms(intent.domain ?? "");
  const audienceTerms = normalizeTerms(options.audience ?? "");
  const semanticTerms = (options.semanticTerms ?? []).filter(
    (term) => !baseTerms.includes(term),
  );
  const denominator = Math.max(1, Math.min(baseTerms.length, 4));

  return records
    .filter((record) =>
      record.asset_version.lifecycle === "published" &&
      record.asset_version.deprecated_at === null &&
      record.asset.current_published_version_id === record.asset_version.asset_version_id)
    .map((record) => {
      const evidence: FieldEvidence[] = [];
      let score = 0;

      for (const [field, weight] of Object.entries(FIELD_WEIGHTS) as Array<
        [SearchableField, number]
      >) {
        const values = searchableValues(record)[field];
        const normalizedFieldTerms = normalizeTerms(values.join(" "));
        const generalMatchedTerms = baseTerms.filter((term) =>
          normalizedFieldTerms.includes(term));
        const fieldContextTerms = field === "domains"
          ? domainTerms
          : field === "audiences"
            ? audienceTerms
            : [];
        const contextMatchedTerms = fieldContextTerms.filter((term) =>
          normalizedFieldTerms.includes(term));
        const matchedTerms = [...new Set([
          ...generalMatchedTerms,
          ...contextMatchedTerms,
        ])];
        const matchedSemanticTerms = semanticTerms.filter((term) =>
          normalizedFieldTerms.includes(term));

        if (matchedTerms.length === 0 && matchedSemanticTerms.length === 0) continue;

        const generalRatio = generalMatchedTerms.length / denominator;
        const contextRatio = fieldContextTerms.length === 0
          ? 0
          : contextMatchedTerms.length / fieldContextTerms.length;
        const semanticRatio = matchedSemanticTerms.length * 0.6 / denominator;
        const contribution = weight * Math.min(1, generalRatio + contextRatio + semanticRatio);
        score += contribution;

        const supportingValue = values.find((value) => {
          const valueTerms = normalizeTerms(value);
          return [...matchedTerms, ...matchedSemanticTerms].some((term) =>
            valueTerms.includes(term));
        }) ?? values[0] ?? field;

        evidence.push({
          field,
          catalogValue: supportingValue,
          matchedTerms,
          semanticTerms: matchedSemanticTerms,
        });
      }

      return { record, score: Math.min(1, score), evidence };
    })
    .filter((candidate) => qualifies(candidate.score, candidate.evidence))
    .sort((left, right) =>
      right.score - left.score ||
      left.record.asset_version.asset_version_id.localeCompare(
        right.record.asset_version.asset_version_id,
      ));
}

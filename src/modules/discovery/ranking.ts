import type { DiscoveryCandidate, DiscoveryRequest } from "@/contracts";
import { normalizeTerms } from "./normalization";
import type { RetrievedCandidate } from "./retrieval";

const GENERIC_QUERY = /\b(?:something|anything|best tool|good asset|help me|various|general)\b/i;

function concise(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 140 ? normalized : `${normalized.slice(0, 137)}…`;
}

export function toCandidate(candidate: RetrievedCandidate): DiscoveryCandidate {
  const { record, score, evidence } = candidate;
  const version = record.asset_version;
  const semanticUsed = evidence.some((item) => item.semanticTerms.length > 0);

  return {
    asset_id: record.asset.asset_id,
    asset_version_id: version.asset_version_id,
    version: version.version,
    match_band: score >= 0.32 ? "strong_match" : "possible_match",
    scoring_method: semanticUsed
      ? "deterministic weighted canonical-field overlap with bounded semantic query expansion"
      : "deterministic weighted canonical-field overlap; ties by asset_version_id",
    matched_fields: evidence.map((item) => item.field),
    rationale: evidence.map((item) => {
      const terms = [...item.matchedTerms, ...item.semanticTerms].join(", ");
      return `Matched ${item.field} value “${concise(item.catalogValue)}” on: ${terms}.`;
    }),
  };
}

export function isAmbiguous(request: DiscoveryRequest): boolean {
  const context = request.optional_context;
  const allTerms = normalizeTerms([
    request.query,
    context?.audience,
    context?.domain,
    context?.desired_output,
    ...(context?.constraints ?? []),
  ].filter(Boolean).join(" "));

  const hasUsefulContext = Boolean(
    context?.audience || context?.domain || context?.desired_output,
  );
  return (!hasUsefulContext && GENERIC_QUERY.test(request.query)) || allTerms.length <= 1;
}

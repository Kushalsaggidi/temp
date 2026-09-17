import type { DiscoveryRequest } from "@/contracts";

const HIGH_IMPACT_PATTERNS = [
  /\b(?:approve|deny|reject|select|rank)\b.{0,40}\b(?:applicant|application|resident|tenant|candidate|request)\b/i,
  /\b(?:evict|eviction|screen applicants?|credit decision|risk score)\b/i,
  /\b(?:hire|fire|terminate employment|employment decision)\b/i,
  /\b(?:diagnos(?:e|is)|medical advice|legal advice)\b/i,
  /\b(?:set|recommend|optimi[sz]e|decide)\b.{0,30}\b(?:rent|price|pricing)\b/i,
  /\b(?:legally correct|automatically decide)\b/i,
] as const;

export function guardrailFor(request: DiscoveryRequest) {
  const searchableRequest = [
    request.query,
    request.optional_context?.audience,
    request.optional_context?.domain,
    request.optional_context?.desired_output,
    ...(request.optional_context?.constraints ?? []),
  ].filter(Boolean).join(" ");

  if (!HIGH_IMPACT_PATTERNS.some((pattern) => pattern.test(searchableRequest))) {
    return { triggered: false as const };
  }

  return {
    triggered: true as const,
    reason:
      "This request asks the marketplace to make or automate a high-impact decision.",
    human_review_point:
      "A qualified human decision-maker must review the facts, applicable policy, and outcome.",
  };
}

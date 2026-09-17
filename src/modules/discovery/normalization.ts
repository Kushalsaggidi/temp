import type { DiscoveryRequest } from "@/contracts";

export type InterpretedIntentItem = {
  goal: string;
  domain?: string;
  desired_output?: string;
  constraints: string[];
};

export type InterpretedIntent = { intents: InterpretedIntentItem[] };

/** Small, explicit vocabulary for deterministic query normalization. */
export const NORMALIZATION_DICTIONARY: Readonly<Record<string, string>> = {
  capex: "capital planning",
  capital: "capital planning",
  checklist: "organize",
  checklists: "organize",
  leases: "lease administration",
  lease: "lease administration",
  residents: "resident communications",
  resident: "resident communications",
  summarize: "summary",
  summarise: "summary",
  suppliers: "procurement",
  supplier: "procurement",
  tenants: "resident communications",
  tenant: "resident communications",
  utilities: "sustainability",
  utility: "sustainability",
  vendors: "procurement",
  vendor: "procurement",
  updates: "communications",
};

const STOP_WORDS = new Set([
  "a", "an", "and", "for", "find", "help", "i", "in", "me", "need",
  "of", "on", "please", "the", "to", "want", "with",
]);

export function normalizeTerms(value: string): string[] {
  const rawTerms = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return [...new Set(
    rawTerms
      .flatMap((term) => (NORMALIZATION_DICTIONARY[term] ?? term).split(/\s+/))
      .filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
  )];
}

export function normalizeIntent(request: DiscoveryRequest): InterpretedIntent {
  const parts = request.query
    .trim()
    .split(/\s+(?:and|also|then)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    intents: parts.map((goal) => ({
      goal: goal.length <= 500 ? goal : `${goal.slice(0, 499).trimEnd()}…`,
      ...(request.optional_context?.domain
        ? { domain: request.optional_context.domain }
        : {}),
      ...(request.optional_context?.desired_output
        ? { desired_output: request.optional_context.desired_output }
        : {}),
      constraints: request.optional_context?.constraints ?? [],
    })),
  };
}

export function intentTerms(
  intent: InterpretedIntentItem,
): string[] {
  return normalizeTerms([
    intent.goal,
    intent.desired_output,
    ...intent.constraints,
  ].filter(Boolean).join(" "));
}

export function normalizeSemanticTerms(terms: string[]): string[] {
  return [...new Set(terms.flatMap(normalizeTerms))].slice(0, 20);
}

import type { AllowlistedExecutor } from "@/shared/ports";

import {
  PROPERTY_OPERATIONS_BRIEF_BEHAVIOR_CONFIG,
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION,
} from "./artifacts";

export interface PropertyOperationsBriefInput {
  brief_title: string;
  audience: string;
  observations: string[];
  constraints?: string[];
}

export interface PropertyOperationsBriefOutput {
  title: string;
  summary: string[];
  review_questions: string[];
  limitations: string[];
}

function humanVerificationQuestion(audience: string): string {
  return PROPERTY_OPERATIONS_BRIEF_BEHAVIOR_CONFIG.human_verification_question_template.replaceAll(
    "{audience}",
    audience,
  );
}

function constraintReviewQuestion(constraint: string): string {
  return PROPERTY_OPERATIONS_BRIEF_BEHAVIOR_CONFIG.constraint_review_question_template.replaceAll(
    "{constraint}",
    constraint,
  );
}

function observationReviewQuestion(observation: string): string {
  return PROPERTY_OPERATIONS_BRIEF_BEHAVIOR_CONFIG.observation_review_question_template.replaceAll(
    "{observation}",
    observation,
  );
}

/**
 * Deterministic, side-effect-free transformation of reviewed structured input.
 * It deliberately does not inspect scenario labels, fetch URLs, load modules, or
 * invoke integrations. Supplied observations remain verbatim, and constraints
 * remain verbatim inside human-owned review questions.
 */
export async function executePropertyOperationsBrief(
  input: PropertyOperationsBriefInput,
): Promise<PropertyOperationsBriefOutput> {
  const constraints = input.constraints ?? [];

  return {
    title: input.brief_title,
    summary: input.observations.map((observation) => observation),
    review_questions: [
      humanVerificationQuestion(input.audience),
      ...input.observations.map(observationReviewQuestion),
      ...constraints.map(constraintReviewQuestion),
    ],
    limitations: [...PROPERTY_OPERATIONS_BRIEF_BEHAVIOR_CONFIG.limitations],
  };
}

export const propertyOperationsBriefExecutor: AllowlistedExecutor<
  PropertyOperationsBriefInput,
  PropertyOperationsBriefOutput
> = Object.freeze({
  key: PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  implementationVersion: PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION,
  definitionDigest: PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  execute: executePropertyOperationsBrief,
});

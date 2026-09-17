import { z } from "zod";

import {
  AssetVersionContentSchema,
  LifecycleStateSchema,
  SlugSchema,
} from "@/contracts";

const ContributorContentSchema = AssetVersionContentSchema.omit({
  asset_version_id: true,
  asset_id: true,
  created_at: true,
  executor_key: true,
  definition_digest: true,
}).extend({
  execution_kind: z.literal("none"),
  availability: z.enum(["reference_only", "request_access"]),
});

export const CreateContributionInputSchema = z
  .object({
    slug: SlugSchema,
    actor_name: z.string().trim().min(1).max(160),
    content: ContributorContentSchema,
  })
  .strict();

export const TransitionInputSchema = z
  .object({
    to_state: LifecycleStateSchema,
    actor_type: z.enum(["team_member", "demo_reviewer"]),
    actor_name: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(2_000),
    confirm_publication: z.literal(true).optional(),
    replacement_version: z.string().trim().min(1).optional(),
  })
  .strict();

export const CreateDraftFromPublishedInputSchema = z
  .object({
    version: z.string().trim().min(1),
    actor_name: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const DemoReviewInputSchema = z
  .object({
    review_type: z.enum([
      "human_review",
      "security_review",
      "source_permission",
    ]),
    result: z.enum(["passed", "failed", "needs_changes", "not_applicable"]),
    reviewer_name: z.string().trim().min(1).max(160),
    reviewer_role: z.string().trim().min(1).max(160).optional(),
    reviewer_organization: z.string().trim().min(1).max(160).optional(),
    scope: z.string().trim().min(1).max(1_000),
    summary: z.string().trim().min(1).max(2_000),
    accept_scoped_security_review: z.boolean().optional(),
  })
  .strict();

export type CreateContributionInput = z.infer<
  typeof CreateContributionInputSchema
>;
export type TransitionInput = z.infer<typeof TransitionInputSchema>;
export type CreateDraftFromPublishedInput = z.infer<
  typeof CreateDraftFromPublishedInputSchema
>;
export type DemoReviewInput = z.infer<typeof DemoReviewInputSchema>;


import { z } from "zod";

import { AssetVersionRecordSchema } from "./catalog";

export const AdminCatalogVersionResponseSchema = AssetVersionRecordSchema;

export const CatalogListResponseSchema = z
  .object({
    items: z.array(AdminCatalogVersionResponseSchema),
    count: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.count !== response.items.length) {
      context.addIssue({
        code: "custom",
        path: ["count"],
        message: "count must equal items.length",
      });
    }
    response.items.forEach((item, index) => {
      if (item.asset_version.lifecycle !== "published") {
        context.addIssue({
          code: "custom",
          path: ["items", index, "asset_version", "lifecycle"],
          message: "Public catalog results may contain only published versions",
        });
      }
      if (item.asset.current_published_version_id !== item.asset_version.asset_version_id) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "asset", "current_published_version_id"],
          message: "Public catalog results must return the asset's current published version",
        });
      }
      if (item.asset_version.subject_digest === null) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "asset_version", "subject_digest"],
          message: "Public catalog results require a frozen subject_digest",
        });
      }
    });
  });

export type AdminCatalogVersionResponse = z.infer<
  typeof AdminCatalogVersionResponseSchema
>;
export type CatalogListResponse = z.infer<typeof CatalogListResponseSchema>;

// Descriptive compatibility name for route code; CatalogListResponse is canonical.
export const PublicCatalogResponseSchema = CatalogListResponseSchema;
export type PublicCatalogResponse = CatalogListResponse;

import { describe, expect, it } from "vitest";

import { publishedCatalogFixtures } from "../../fixtures/catalog/published-catalog";
import { AssetVersionContentSchema, AssetVersionRecordSchema } from "@/contracts";
import { computeSubjectDigest } from "@/shared/integrity";

describe("published catalog fixtures", () => {
  it("keeps every representative catalog fixture schema-valid and truthfully non-runnable", () => {
    expect(publishedCatalogFixtures).toHaveLength(10);

    for (const recordValue of publishedCatalogFixtures) {
      const record = AssetVersionRecordSchema.parse(recordValue);
      const { lifecycle, subject_digest, published_at, deprecated_at, replacement_version, ...contentValue } = record.asset_version;
      const content = AssetVersionContentSchema.parse(contentValue);

      expect(lifecycle).toBe("published");
      expect(record.asset_version.availability).toBe("reference_only");
      expect(record.asset_version.execution_kind).toBe("none");
      expect(record.asset_version.executor_key).toBeUndefined();
      expect(record.asset_version.permission_evidence_id).toBeNull();
      expect(subject_digest).toBe(computeSubjectDigest(content));
      expect(published_at).not.toBeNull();
      expect(deprecated_at).toBeNull();
      expect(replacement_version).toBeNull();
    }
  });
});

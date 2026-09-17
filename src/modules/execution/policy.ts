import {
  AssetVersionContentSchema,
  type AssetVersionRecord,
  type JSONValue,
} from "@/contracts";
import { computeSubjectDigest } from "@/shared/integrity";

export type ExecutionPurpose = "user_run" | "prepublication_test";

export interface PolicyDecision {
  allowed: boolean;
  code: string;
  message: string;
}

const BLOCKED_HIGH_IMPACT_PATTERNS = [
  /\b(?:evict|eviction|deny housing|approve (?:a )?(?:tenant|applicant)|reject (?:a )?(?:tenant|applicant))\b/i,
  /\b(?:rank|score|prioriti[sz]e)\s+(?:residents?|tenants?|employees?|applicants?|vendors?)\b/i,
  /\b(?:hire|fire|terminate|discipline)\s+(?:an?\s+)?employees?\b/i,
  /\b(?:make|issue|send|release|authorize)\s+(?:a\s+)?(?:payment|refund|charge)\b/i,
  /\b(?:dispatch|close|cancel|update)\s+(?:a\s+)?(?:work order|production record)\b/i,
] as const;

const SECRET_KEY_PATTERN = /(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key|authorization)/i;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/i,
  /\b(?:sk|rk|pk)[_-](?:proj[_-])?[A-Za-z0-9_-]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i,
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]{6,}/i,
] as const;

export function evaluateVersionPolicy(
  record: AssetVersionRecord,
  purpose: ExecutionPurpose,
): PolicyDecision {
  const version = record.asset_version;

  if (version.availability !== "runnable") {
    return {
      allowed: false,
      code: "asset_not_runnable",
      message: "This asset version is not available for execution.",
    };
  }
  if (!version.executor_key || !version.definition_digest) {
    return {
      allowed: false,
      code: "executor_metadata_missing",
      message: "This asset version does not have complete reviewed executor metadata.",
    };
  }
  if (version.subject_digest === null) {
    return {
      allowed: false,
      code: "asset_not_frozen",
      message: "This asset version has not been frozen for execution evidence.",
    };
  }
  const {
    lifecycle: _lifecycle,
    subject_digest: _subjectDigest,
    published_at: _publishedAt,
    deprecated_at: _deprecatedAt,
    replacement_version: _replacementVersion,
    ...contentValue
  } = version;
  try {
    const canonicalSubjectDigest = computeSubjectDigest(
      AssetVersionContentSchema.parse(contentValue),
    );
    if (canonicalSubjectDigest !== version.subject_digest) {
      return {
        allowed: false,
        code: "subject_digest_mismatch",
        message: "The frozen asset content does not match its subject digest.",
      };
    }
  } catch {
    return {
      allowed: false,
      code: "subject_digest_mismatch",
      message: "The frozen asset content does not match its subject digest.",
    };
  }
  if (
    version.access_permission === "unconfirmed" ||
    version.tool_use_permission === "unconfirmed" ||
    version.final_package_permission === "unconfirmed"
  ) {
    return {
      allowed: false,
      code: "permissions_unconfirmed",
      message: "Required permissions have not been confirmed for this version.",
    };
  }
  if (version.deprecated_at !== null || version.lifecycle === "deprecated") {
    return {
      allowed: false,
      code: "asset_deprecated",
      message: "Deprecated asset versions cannot be executed.",
    };
  }

  if (purpose === "user_run") {
    if (
      version.lifecycle !== "published" ||
      version.published_at === null ||
      record.asset.current_published_version_id !== version.asset_version_id
    ) {
      return {
        allowed: false,
        code: "asset_not_public",
        message: "This asset version is not the current published version.",
      };
    }
  } else if (version.lifecycle === "published") {
    return {
      allowed: false,
      code: "prepublication_requires_unpublished",
      message: "The maintainer harness only accepts frozen unpublished versions.",
    };
  }

  return {
    allowed: true,
    code: "policy_allowed",
    message: "Lifecycle, availability, permission, and purpose checks passed.",
  };
}

function walkJson(
  value: JSONValue,
  visit: (key: string | undefined, value: JSONValue) => boolean,
  key?: string,
): boolean {
  if (visit(key, value)) return true;
  if (Array.isArray(value)) {
    return value.some((item) => walkJson(item, visit));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([childKey, child]) =>
      walkJson(child, visit, childKey),
    );
  }
  return false;
}

export function containsPotentialSecret(value: JSONValue): boolean {
  return walkJson(value, (key, item) => {
    if (key && SECRET_KEY_PATTERN.test(key)) return true;
    return (
      typeof item === "string" &&
      SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(item))
    );
  });
}

export function evaluateHighImpactPolicy(value: JSONValue): PolicyDecision {
  const blocked = walkJson(
    value,
    (_key, item) =>
      typeof item === "string" &&
      BLOCKED_HIGH_IMPACT_PATTERNS.some((pattern) => pattern.test(item)),
  );

  return blocked
    ? {
        allowed: false,
        code: "high_impact_action_blocked",
        message:
          "Inputs requesting automated high-impact or production actions are not allowed.",
      }
    : {
        allowed: true,
        code: "high_impact_policy_allowed",
        message: "No automated high-impact or production action was requested.",
      };
}

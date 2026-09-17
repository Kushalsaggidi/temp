CREATE TABLE assets (
  asset_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  current_published_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(asset_id)) > 0),
  CHECK (length(trim(created_at)) > 0),
  CHECK (length(trim(updated_at)) > 0),
  CHECK (length(trim(slug)) > 0),
  FOREIGN KEY (current_published_version_id)
    REFERENCES asset_versions(asset_version_id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE asset_versions (
  asset_version_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  version TEXT NOT NULL,
  content_json TEXT NOT NULL,
  subject_digest TEXT,
  lifecycle TEXT NOT NULL,
  published_at TEXT,
  deprecated_at TEXT,
  replacement_version TEXT,
  created_at TEXT NOT NULL,
  CHECK (length(trim(asset_version_id)) > 0),
  CHECK (length(trim(asset_id)) > 0),
  CHECK (length(trim(version)) > 0),
  CHECK (json_valid(content_json) AND json_type(content_json) = 'object'),
  CHECK (json_extract(content_json, '$.asset_version_id') IS asset_version_id),
  CHECK (json_extract(content_json, '$.asset_id') IS asset_id),
  CHECK (json_extract(content_json, '$.version') IS version),
  CHECK (json_extract(content_json, '$.created_at') IS created_at),
  CHECK (json_type(content_json, '$.lifecycle') IS NULL),
  CHECK (json_type(content_json, '$.subject_digest') IS NULL),
  CHECK (json_type(content_json, '$.published_at') IS NULL),
  CHECK (json_type(content_json, '$.deprecated_at') IS NULL),
  CHECK (json_type(content_json, '$.replacement_version') IS NULL),
  CHECK (
    subject_digest IS NULL OR (
      length(subject_digest) = 71
      AND substr(subject_digest, 1, 7) = 'sha256:'
      AND substr(subject_digest, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (lifecycle IN (
    'draft',
    'submitted',
    'in_review',
    'changes_requested',
    'published',
    'deprecated'
  )),
  CHECK (lifecycle NOT IN ('published', 'deprecated') OR (subject_digest IS NOT NULL AND published_at IS NOT NULL)),
  CHECK (
    lifecycle NOT IN ('published', 'deprecated') OR (
      COALESCE(json_extract(content_json, '$.access_permission') IN ('confirmed', 'not_applicable'), 0)
      AND COALESCE(json_extract(content_json, '$.tool_use_permission') IN ('confirmed', 'not_applicable'), 0)
      AND COALESCE(json_extract(content_json, '$.final_package_permission') IN ('confirmed', 'not_applicable'), 0)
    )
  ),
  CHECK (lifecycle IN ('published', 'deprecated') OR published_at IS NULL),
  CHECK (lifecycle = 'deprecated' OR deprecated_at IS NULL),
  CHECK (lifecycle <> 'deprecated' OR deprecated_at IS NOT NULL),
  CHECK (replacement_version IS NULL OR (lifecycle = 'deprecated' AND length(trim(replacement_version)) > 0)),
  CHECK (length(trim(created_at)) > 0),
  UNIQUE (asset_id, version),
  UNIQUE (asset_id, asset_version_id),
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE RESTRICT,
  FOREIGN KEY (replacement_version) REFERENCES asset_versions(asset_version_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  result TEXT NOT NULL,
  subject_digest TEXT NOT NULL,
  record_json TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  CHECK (length(trim(evidence_id)) > 0),
  CHECK (evidence_type IN (
    'metadata_validation',
    'functional_test',
    'guardrail_test',
    'reuse_test',
    'human_review',
    'security_review',
    'source_permission'
  )),
  CHECK (result IN ('passed', 'failed', 'needs_changes', 'informational', 'not_applicable')),
  CHECK (
    length(subject_digest) = 71
    AND substr(subject_digest, 1, 7) = 'sha256:'
    AND substr(subject_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  CHECK (json_extract(record_json, '$.evidence_id') IS evidence_id),
  CHECK (json_extract(record_json, '$.asset_id') IS asset_id),
  CHECK (json_extract(record_json, '$.asset_version_id') IS asset_version_id),
  CHECK (json_extract(record_json, '$.evidence_type') IS evidence_type),
  CHECK (json_extract(record_json, '$.result') IS result),
  CHECK (json_extract(record_json, '$.subject_digest') IS subject_digest),
  CHECK (json_extract(record_json, '$.timestamp') IS timestamp),
  CHECK (length(trim(timestamp)) > 0),
  FOREIGN KEY (asset_id, asset_version_id)
    REFERENCES asset_versions(asset_id, asset_version_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE executions (
  execution_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  record_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (length(trim(execution_id)) > 0),
  CHECK (purpose IN ('user_run', 'prepublication_test')),
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'invalid', 'blocked')),
  CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  CHECK (json_extract(record_json, '$.execution_id') IS execution_id),
  CHECK (json_extract(record_json, '$.asset_id') IS asset_id),
  CHECK (json_extract(record_json, '$.asset_version_id') IS asset_version_id),
  CHECK (json_extract(record_json, '$.purpose') IS purpose),
  CHECK (json_extract(record_json, '$.status') IS status),
  CHECK (json_extract(record_json, '$.started_at') IS started_at),
  CHECK (json_extract(record_json, '$.completed_at') IS completed_at),
  CHECK (length(trim(started_at)) > 0),
  FOREIGN KEY (asset_id, asset_version_id)
    REFERENCES asset_versions(asset_id, asset_version_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifecycle_events (
  event_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_name TEXT,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  CHECK (length(trim(event_id)) > 0),
  CHECK (from_state IS NULL OR from_state IN (
    'draft',
    'submitted',
    'in_review',
    'changes_requested',
    'published',
    'deprecated'
  )),
  CHECK (to_state IN (
    'draft',
    'submitted',
    'in_review',
    'changes_requested',
    'published',
    'deprecated'
  )),
  CHECK (from_state IS NULL OR from_state <> to_state),
  CHECK (actor_type IN ('system', 'team_member', 'demo_reviewer')),
  CHECK (actor_type <> 'system' OR actor_name IS NULL),
  CHECK (json_valid(evidence_ids_json) AND json_type(evidence_ids_json) = 'array'),
  CHECK (length(trim(reason)) > 0),
  CHECK (length(trim(timestamp)) > 0),
  FOREIGN KEY (asset_id, asset_version_id)
    REFERENCES asset_versions(asset_id, asset_version_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX asset_versions_asset_id_idx ON asset_versions(asset_id);
CREATE INDEX asset_versions_discovery_idx ON asset_versions(lifecycle, deprecated_at, published_at);
CREATE INDEX evidence_asset_version_id_idx ON evidence(asset_version_id);
CREATE INDEX executions_asset_version_id_idx ON executions(asset_version_id);
CREATE INDEX lifecycle_events_asset_version_id_idx ON lifecycle_events(asset_version_id, timestamp);

CREATE TRIGGER asset_versions_identity_immutable
BEFORE UPDATE OF asset_version_id, asset_id, version, created_at ON asset_versions
WHEN NEW.asset_version_id IS NOT OLD.asset_version_id
  OR NEW.asset_id IS NOT OLD.asset_id
  OR NEW.version IS NOT OLD.version
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'asset version identity is immutable');
END;

CREATE TRIGGER asset_versions_frozen_content_immutable
BEFORE UPDATE OF content_json ON asset_versions
WHEN NEW.content_json IS NOT OLD.content_json
  AND (OLD.subject_digest IS NOT NULL OR OLD.published_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'frozen or published version content is immutable');
END;

CREATE TRIGGER asset_versions_digest_immutable
BEFORE UPDATE OF subject_digest ON asset_versions
WHEN OLD.subject_digest IS NOT NULL AND NEW.subject_digest IS NOT OLD.subject_digest
BEGIN
  SELECT RAISE(ABORT, 'subject digest cannot change after freeze');
END;

CREATE TRIGGER asset_versions_published_at_immutable
BEFORE UPDATE OF published_at ON asset_versions
WHEN OLD.published_at IS NOT NULL AND NEW.published_at IS NOT OLD.published_at
BEGIN
  SELECT RAISE(ABORT, 'published timestamp cannot change');
END;

CREATE TRIGGER asset_versions_published_delete_guard
BEFORE DELETE ON asset_versions
WHEN OLD.published_at IS NOT NULL OR OLD.lifecycle = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published versions cannot be deleted');
END;

CREATE TRIGGER assets_current_version_insert_guard
BEFORE INSERT ON assets
WHEN NEW.current_published_version_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM asset_versions
    WHERE asset_version_id = NEW.current_published_version_id
      AND asset_id = NEW.asset_id
      AND lifecycle = 'published'
      AND deprecated_at IS NULL
  ) THEN RAISE(ABORT, 'current version must be a published, nondeprecated version of the asset') END;
END;

CREATE TRIGGER assets_current_version_update_guard
BEFORE UPDATE OF current_published_version_id ON assets
WHEN NEW.current_published_version_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM asset_versions
    WHERE asset_version_id = NEW.current_published_version_id
      AND asset_id = NEW.asset_id
      AND lifecycle = 'published'
      AND deprecated_at IS NULL
  ) THEN RAISE(ABORT, 'current version must be a published, nondeprecated version of the asset') END;
END;

CREATE TRIGGER asset_versions_current_pointer_guard
BEFORE UPDATE OF lifecycle, deprecated_at ON asset_versions
WHEN EXISTS (
  SELECT 1
  FROM assets
  WHERE assets.current_published_version_id = OLD.asset_version_id
)
AND (NEW.lifecycle <> 'published' OR NEW.deprecated_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'clear the asset current pointer before unpublishing or deprecating its version');
END;

CREATE TRIGGER evidence_update_guard
BEFORE UPDATE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence records are immutable');
END;

CREATE TRIGGER evidence_subject_digest_guard
BEFORE INSERT ON evidence
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM asset_versions
    WHERE asset_version_id = NEW.asset_version_id
      AND asset_id = NEW.asset_id
      AND subject_digest IS NOT NULL
      AND subject_digest = NEW.subject_digest
  ) THEN RAISE(ABORT, 'evidence subject digest must match the frozen asset version') END;
END;

CREATE TRIGGER evidence_delete_guard
BEFORE DELETE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence records are immutable');
END;

CREATE TRIGGER lifecycle_events_update_guard
BEFORE UPDATE ON lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'lifecycle events are append-only');
END;

CREATE TRIGGER lifecycle_events_delete_guard
BEFORE DELETE ON lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'lifecycle events are append-only');
END;

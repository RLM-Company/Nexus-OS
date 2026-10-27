/**
 * @cosmora/db — Migration 005: Kosmora Playbooks Tables & Indexes
 * Creates playbooks, playbook_versions, playbook_instantiations, and playbook_audit_events
 * with tenant/project/owner/status/category/visibility indexes, unique version constraints,
 * and mission <-> playbook version linkage.
 */

export const PLAYBOOKS_MIGRATION_VERSION = 5 as const;
export const PLAYBOOKS_MIGRATION_NAME =
  "005_kosmora_playbooks_tables" as const;

export const PLAYBOOKS_MIGRATION_UP_SQL = `
  CREATE TABLE IF NOT EXISTS playbooks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT,
    owner_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Общие',
    tags_json TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'private',
    status TEXT NOT NULL DEFAULT 'draft',
    current_version INTEGER NOT NULL DEFAULT 0,
    draft_definition_json TEXT NOT NULL,
    draft_version_lock INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_playbooks_tenant_project_owner_status
    ON playbooks(tenant_id, project_id, owner_id, status, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_playbooks_category_visibility
    ON playbooks(category, visibility, status, updated_at DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_playbooks_slug_scope
    ON playbooks(tenant_id, COALESCE(project_id, '__global__'), slug);

  CREATE TABLE IF NOT EXISTS playbook_versions (
    id TEXT PRIMARY KEY,
    playbook_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    definition_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    is_published INTEGER NOT NULL DEFAULT 1
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_playbook_versions_playbook_version
    ON playbook_versions(playbook_id, version_number);

  CREATE INDEX IF NOT EXISTS idx_playbook_versions_lookup
    ON playbook_versions(playbook_id, is_published, version_number DESC);

  CREATE TABLE IF NOT EXISTS playbook_instantiations (
    id TEXT PRIMARY KEY,
    playbook_id TEXT NOT NULL,
    playbook_version_id TEXT NOT NULL,
    resulting_mission_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    resolved_variables_json TEXT NOT NULL DEFAULT '{}',
    initiated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_playbook_instantiations_mission
    ON playbook_instantiations(resulting_mission_id);

  CREATE INDEX IF NOT EXISTS idx_playbook_instantiations_playbook_version
    ON playbook_instantiations(playbook_id, playbook_version_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_playbook_instantiations_tenant_project
    ON playbook_instantiations(tenant_id, project_id, owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS playbook_audit_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT,
    playbook_id TEXT NOT NULL,
    playbook_version_id TEXT,
    resulting_mission_id TEXT,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_playbook_audit_events_playbook
    ON playbook_audit_events(playbook_id, created_at ASC);

  CREATE INDEX IF NOT EXISTS idx_playbook_audit_events_tenant_project
    ON playbook_audit_events(tenant_id, project_id, event_type, created_at DESC);
`;

export const PLAYBOOKS_MIGRATION_DOWN_SQL = `
  DROP TABLE IF EXISTS playbook_audit_events;
  DROP TABLE IF EXISTS playbook_instantiations;
  DROP TABLE IF EXISTS playbook_versions;
  DROP TABLE IF EXISTS playbooks;
`;

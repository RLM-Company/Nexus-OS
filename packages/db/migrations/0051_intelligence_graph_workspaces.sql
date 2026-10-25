-- Managed graph workspace/history/import storage. Runtime never creates these tables.
CREATE TABLE intelligence_graph_workspaces (
  graph_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX intelligence_graph_workspaces_owner_project_idx
  ON intelligence_graph_workspaces(owner_id, project_id, updated_at, graph_id);
--> statement-breakpoint
CREATE TABLE intelligence_graph_workspace_revisions (
  graph_id TEXT NOT NULL
    REFERENCES intelligence_graph_workspaces(graph_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  summary TEXT NOT NULL,
  restored_from_revision INTEGER CHECK(restored_from_revision IS NULL OR restored_from_revision >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY(graph_id, revision)
);
--> statement-breakpoint
CREATE INDEX intelligence_graph_workspace_revisions_history_idx
  ON intelligence_graph_workspace_revisions(graph_id, revision DESC);
--> statement-breakpoint
CREATE TABLE intelligence_graph_import_receipts (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  creation_key TEXT NOT NULL CHECK(length(creation_key) BETWEEN 16 AND 128),
  package_sha256 TEXT NOT NULL CHECK(length(package_sha256)=64),
  graph_id TEXT REFERENCES intelligence_graph_workspaces(graph_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, project_id, creation_key)
);

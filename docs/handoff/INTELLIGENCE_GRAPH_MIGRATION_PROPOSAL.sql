-- PROPOSAL ONLY: NOT A MANAGED MIGRATION AND NOT INSTALLED.
-- Integration owner MUST allocate the next free slot after all already
-- reserved migrations 0025..0034 and update the drizzle migration journal.
-- Do not run this SQL from API startup handlers or module constructors.
-- Tables deliberately store only owner-entered graph data (no model usage).

CREATE TABLE intelligence_graph_workspaces (
  graph_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX intelligence_graph_workspaces_owner_project_idx
  ON intelligence_graph_workspaces(owner_id, project_id, updated_at, graph_id);

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
CREATE INDEX intelligence_graph_workspace_revisions_history_idx
  ON intelligence_graph_workspace_revisions(graph_id, revision DESC);

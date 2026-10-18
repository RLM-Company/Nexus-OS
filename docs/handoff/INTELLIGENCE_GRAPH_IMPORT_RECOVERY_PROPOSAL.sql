-- PROPOSAL ONLY. Apply through a managed migration after graph workspace tables.
-- Integration remains OFF until privacy export/delete/quiesce includes receipts.
CREATE TABLE intelligence_graph_import_receipts (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  creation_key TEXT NOT NULL CHECK(length(creation_key) BETWEEN 16 AND 128),
  package_sha256 TEXT NOT NULL CHECK(length(package_sha256)=64),
  graph_id TEXT REFERENCES intelligence_graph_workspaces(graph_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, project_id, creation_key)
);

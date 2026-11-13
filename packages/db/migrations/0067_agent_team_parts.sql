-- Runtime lifecycle for the parts of a confirmed agent team composition.
-- `agent_instances` stays an immutable proposals-only table (DB CHECK
-- status='proposed'); this table owns activation/terminal states. One row per
-- part (blueprint instance) of one composition activation. Part artifacts are
-- not copied: they are the existing immutable work_artifact_versions for the
-- child Work bound to the DAG node, read back with sha256 verification.
CREATE TABLE agent_team_parts (
 owner_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 composition_id TEXT NOT NULL CHECK(length(composition_id)=64),
 graph_id TEXT NOT NULL,
 instance_id TEXT NOT NULL,
 node_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','completed','failed','cancelled')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id, project_id, composition_id, instance_id),
 FOREIGN KEY(project_id, owner_id) REFERENCES projects(id, owner_id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id, project_id, composition_id)
   REFERENCES agent_team_compositions(owner_id, project_id, composition_id) ON DELETE CASCADE,
 FOREIGN KEY(instance_id, owner_id, project_id)
   REFERENCES agent_instances(instance_id, owner_id, project_id) ON DELETE CASCADE
);
CREATE INDEX agent_team_parts_project_status_idx
 ON agent_team_parts(project_id, status, updated_at);

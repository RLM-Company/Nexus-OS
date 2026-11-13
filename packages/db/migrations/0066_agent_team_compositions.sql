-- Agent team compositions confirmed by the owner. A composition is the stable
-- set of project blueprints (sha256 over the sorted `blueprint_id@version`
-- list); confirming it once (owner decision 2026-11-13: blueprint-oriented
-- teams) means later runs of the same composition skip re-confirmation.
CREATE TABLE agent_team_compositions (
 owner_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 composition_id TEXT NOT NULL CHECK(length(composition_id)=64),
 blueprint_refs_json TEXT NOT NULL CHECK(length(blueprint_refs_json) BETWEEN 2 AND 20000),
 confirmed_by_actor_id TEXT NOT NULL,
 confirmed_at TEXT NOT NULL,
 PRIMARY KEY(owner_id, project_id, composition_id),
 FOREIGN KEY(project_id, owner_id) REFERENCES projects(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX agent_team_compositions_project_confirmed_idx
 ON agent_team_compositions(project_id, confirmed_at);

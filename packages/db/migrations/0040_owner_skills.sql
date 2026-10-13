CREATE TABLE owner_skills (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX owner_skills_owner_updated ON owner_skills(owner_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE owner_skill_versions (
  skill_id TEXT NOT NULL REFERENCES owner_skills(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  instructions TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, version)
);
--> statement-breakpoint
CREATE INDEX owner_skill_versions_owner ON owner_skill_versions(owner_id, skill_id, version DESC);
--> statement-breakpoint
CREATE TRIGGER owner_skills_fence_insert BEFORE INSERT ON owner_skills BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER owner_skills_fence_update BEFORE UPDATE ON owner_skills BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER owner_skill_versions_fence_insert BEFORE INSERT ON owner_skill_versions BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
  SELECT RAISE(ABORT,'OWNER_MISMATCH') WHERE NOT EXISTS
    (SELECT 1 FROM owner_skills WHERE id=NEW.skill_id AND owner_id=NEW.owner_id);
END;

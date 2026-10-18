-- Keep a bounded durable receipt after deletion so retries never resurrect a Skill.
CREATE TABLE owner_skill_creations (
  owner_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  draft_sha256 TEXT NOT NULL CHECK(length(draft_sha256)=64),
  skill_id TEXT UNIQUE REFERENCES owner_skills(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,request_id)
);
--> statement-breakpoint
CREATE TRIGGER owner_skill_creations_insert BEFORE INSERT ON owner_skill_creations BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  );
  SELECT RAISE(ABORT,'OWNER_MISMATCH') WHERE NOT EXISTS (
    SELECT 1 FROM owner_skills WHERE id=NEW.skill_id AND owner_id=NEW.owner_id
  );
END;
--> statement-breakpoint
CREATE TRIGGER owner_skill_creations_immutable BEFORE UPDATE ON owner_skill_creations
WHEN NEW.owner_id<>OLD.owner_id OR NEW.request_id<>OLD.request_id
  OR NEW.draft_sha256<>OLD.draft_sha256 OR NEW.created_at<>OLD.created_at
  OR NEW.skill_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'SKILL_CREATION_IMMUTABLE'); END;

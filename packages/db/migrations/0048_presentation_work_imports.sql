-- Independent provenance, retained after source deletion; tombstones prevent retry resurrection.
CREATE TABLE presentation_work_imports (
  owner_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  presentation_id TEXT UNIQUE REFERENCES presentations(id) ON DELETE SET NULL,
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,source_key)
);
--> statement-breakpoint
CREATE TRIGGER presentation_work_imports_fence BEFORE INSERT ON presentation_work_imports BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  );
  SELECT RAISE(ABORT,'OWNER_MISMATCH') WHERE NOT EXISTS (
    SELECT 1 FROM presentations WHERE id=NEW.presentation_id AND owner_id=NEW.owner_id
  );
END;
--> statement-breakpoint
CREATE TRIGGER presentation_work_imports_immutable BEFORE UPDATE ON presentation_work_imports
WHEN NEW.owner_id<>OLD.owner_id OR NEW.source_key<>OLD.source_key OR NEW.source_json<>OLD.source_json OR NEW.created_at<>OLD.created_at OR NEW.presentation_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'PRESENTATION_SOURCE_IMMUTABLE'); END;

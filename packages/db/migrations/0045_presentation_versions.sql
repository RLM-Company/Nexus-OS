CREATE UNIQUE INDEX presentations_id_owner ON presentations(id, owner_id);
--> statement-breakpoint
CREATE TABLE presentation_versions (
  presentation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('paper','night','ocean')),
  slides_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('create','save','import','restore','migration')),
  source_version INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (presentation_id, version),
  FOREIGN KEY (presentation_id, owner_id) REFERENCES presentations(id, owner_id) ON DELETE CASCADE,
  CHECK ((source='restore' AND source_version IS NOT NULL AND source_version > 0) OR (source<>'restore' AND source_version IS NULL))
);
--> statement-breakpoint
INSERT INTO presentation_versions(presentation_id,owner_id,version,title,theme,slides_json,source,created_at)
SELECT id,owner_id,version,title,theme,slides_json,'migration',updated_at FROM presentations;
--> statement-breakpoint
CREATE INDEX presentation_versions_owner ON presentation_versions(owner_id, presentation_id, version DESC);
--> statement-breakpoint
CREATE TRIGGER presentation_versions_fence_insert BEFORE INSERT ON presentation_versions BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_versions_immutable BEFORE UPDATE ON presentation_versions BEGIN
  SELECT RAISE(ABORT, 'PRESENTATION_VERSION_IMMUTABLE');
END;

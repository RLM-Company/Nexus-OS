CREATE TABLE presentations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'paper',
  slides_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (version > 0),
  CHECK (theme IN ('paper','night','ocean'))
);
--> statement-breakpoint
CREATE INDEX presentations_owner_updated ON presentations(owner_id, updated_at DESC);
--> statement-breakpoint
CREATE TRIGGER presentations_fence_insert BEFORE INSERT ON presentations BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER presentations_fence_update BEFORE UPDATE ON presentations BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

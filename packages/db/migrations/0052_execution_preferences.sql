CREATE TABLE IF NOT EXISTS kosmora_execution_preferences (
  owner_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK(version>=1),
  model_profile TEXT NOT NULL CHECK(model_profile IN ('mercurius','mars','jupiter','saturnus')),
  autonomy INTEGER NOT NULL CHECK(autonomy BETWEEN 0 AND 6),
  turbo INTEGER NOT NULL CHECK(turbo IN (0,1)),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS execution_preferences_insert BEFORE INSERT ON kosmora_execution_preferences BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  );
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_media_usage (
  operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
  kind TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
  hold_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reserved','committed','uncertain','cancelled')),
  reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>0),
  input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_usage_insert BEFORE INSERT ON kosmora_media_usage BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_usage_update BEFORE UPDATE ON kosmora_media_usage BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE NEW.owner_id<>OLD.owner_id OR EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS execution_preferences_update BEFORE UPDATE ON kosmora_execution_preferences BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE NEW.owner_id<>OLD.owner_id OR EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  );
END;

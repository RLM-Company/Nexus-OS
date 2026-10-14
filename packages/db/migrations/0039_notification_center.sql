CREATE TABLE notification_preferences (
  owner_id TEXT PRIMARY KEY NOT NULL,
  in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (in_app_enabled IN (0,1)),
  browser_enabled INTEGER NOT NULL DEFAULT 0 CHECK (browser_enabled IN (0,1)),
  quiet_from TEXT,
  quiet_until TEXT,
  time_zone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  updated_at TEXT NOT NULL,
  CHECK ((quiet_from IS NULL AND quiet_until IS NULL) OR (quiet_from IS NOT NULL AND quiet_until IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE notification_reads (
  owner_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, event_key)
);
--> statement-breakpoint
CREATE INDEX notification_reads_owner_time ON notification_reads(owner_id, read_at DESC);
--> statement-breakpoint
CREATE TRIGGER notification_preferences_fence_insert BEFORE INSERT ON notification_preferences BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER notification_preferences_fence_update BEFORE UPDATE ON notification_preferences BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER notification_reads_fence_insert BEFORE INSERT ON notification_reads BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

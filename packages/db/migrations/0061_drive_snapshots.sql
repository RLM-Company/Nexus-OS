CREATE TABLE drive_snapshots (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES kosmora_drive_connections(owner_id) ON DELETE CASCADE,
 connection_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 selection_sha TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 33554432),
 sha256 TEXT NOT NULL,
 part_count INTEGER NOT NULL CHECK(part_count BETWEEN 1 AND 16),
 parts_json TEXT NOT NULL CHECK(json_valid(parts_json)),
 preview_json TEXT NOT NULL CHECK(json_valid(preview_json)),
 payload BLOB,
 state TEXT NOT NULL CHECK(state IN ('prepared','uploading','uncertain','verified','discarded')),
 preview_token TEXT,
 preview_until INTEGER,
 preview_epoch INTEGER,
 preview_connection TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id,operation_id)
);
--> statement-breakpoint
CREATE TABLE drive_restores (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL REFERENCES drive_snapshots(id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL,
 UNIQUE(owner_id,operation_id)
);
--> statement-breakpoint
CREATE TABLE drive_restored_files (
 id TEXT PRIMARY KEY,
 restore_id TEXT NOT NULL REFERENCES drive_restores(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 name TEXT NOT NULL,
 source_project TEXT NOT NULL,
 source_version INTEGER NOT NULL,
 content TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX drive_snapshots_owner ON drive_snapshots(owner_id,created_at DESC,id);
--> statement-breakpoint
CREATE INDEX drive_restored_files_owner ON drive_restored_files(owner_id,restore_id);
--> statement-breakpoint
CREATE TRIGGER drive_snapshots_insert BEFORE INSERT ON drive_snapshots BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER drive_snapshots_update BEFORE UPDATE ON drive_snapshots BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER drive_restores_insert BEFORE INSERT ON drive_restores BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER drive_restores_update BEFORE UPDATE ON drive_restores BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER drive_restored_files_insert BEFORE INSERT ON drive_restored_files BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER drive_restored_files_update BEFORE UPDATE ON drive_restored_files BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

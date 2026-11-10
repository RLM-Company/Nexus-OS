CREATE TABLE IF NOT EXISTS kosmora_drive_connections (
  owner_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  connection_id TEXT,
  grant_ciphertext TEXT,
  grant_version INTEGER NOT NULL DEFAULT 0 CHECK(grant_version>=0),
  folder_id TEXT,
  folder_state TEXT NOT NULL CHECK(folder_state IN ('disconnected','reserved','creating','uncertain','ready')),
  folder_lease TEXT,
  updated_at TEXT NOT NULL,
  CHECK((folder_state='disconnected' AND connection_id IS NULL AND grant_ciphertext IS NULL AND folder_id IS NULL AND folder_lease IS NULL) OR
        (folder_state<>'disconnected' AND connection_id IS NOT NULL AND grant_ciphertext IS NOT NULL AND folder_id IS NOT NULL AND (folder_state='creating' OR folder_state='uncertain' OR folder_state='ready'))),
  CHECK((folder_state='creating' AND folder_lease IS NOT NULL) OR (folder_state<>'creating' AND folder_lease IS NULL))
);

CREATE TABLE IF NOT EXISTS kosmora_drive_archives (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES kosmora_drive_connections(owner_id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  file_id TEXT NOT NULL UNIQUE,
  folder_id TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN ('reserved','uploading','checking','uncertain','verified','failed')),
  lease TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id,connection_id,operation_id),
  CHECK((state IN ('uploading','checking') AND lease IS NOT NULL) OR
        (state NOT IN ('uploading','checking') AND lease IS NULL))
);

CREATE INDEX IF NOT EXISTS kosmora_drive_archives_owner ON kosmora_drive_archives(owner_id,created_at DESC,id);

CREATE TRIGGER IF NOT EXISTS kosmora_drive_connections_fence_insert BEFORE INSERT ON kosmora_drive_connections BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED') WHERE EXISTS
  (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

CREATE TRIGGER IF NOT EXISTS kosmora_drive_connections_fence_update BEFORE UPDATE ON kosmora_drive_connections BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED') WHERE EXISTS
  (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

CREATE TRIGGER IF NOT EXISTS kosmora_drive_archives_fence_insert BEFORE INSERT ON kosmora_drive_archives BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED') WHERE EXISTS
  (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

CREATE TRIGGER IF NOT EXISTS kosmora_drive_archives_fence_update BEFORE UPDATE ON kosmora_drive_archives BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED') WHERE EXISTS
  (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

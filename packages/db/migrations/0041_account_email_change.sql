CREATE TABLE auth_email_changes (
  token_hash TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES auth_accounts(owner_id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_email_changes_owner ON auth_email_changes(owner_id);
--> statement-breakpoint
CREATE TRIGGER auth_email_changes_fence_insert BEFORE INSERT ON auth_email_changes BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
    (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

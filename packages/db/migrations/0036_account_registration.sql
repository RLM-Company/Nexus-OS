CREATE TABLE auth_accounts (
  owner_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE auth_email_verifications (
  token_hash TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES auth_accounts(owner_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_email_verifications_owner_idx ON auth_email_verifications(owner_id);

CREATE TABLE IF NOT EXISTS developer_api_keys (
  key_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS developer_api_keys_owner_idx ON developer_api_keys(owner_id, revoked_at);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS developer_api_tasks (
  task_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  files_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
  request_hash TEXT NOT NULL,
  result_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, client_request_id)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS developer_api_tasks_owner_idx ON developer_api_tasks(owner_id, status);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS developer_api_webhooks (
  webhook_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  url TEXT NOT NULL,
  events_json TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS developer_api_usage (
  usage_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  run_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  first_token_ms INTEGER,
  total_ms INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, request_id)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS developer_api_deliveries (
  delivery_id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed')),
  created_at TEXT NOT NULL,
  UNIQUE(webhook_id, event, payload_sha256)
);

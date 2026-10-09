-- Standalone additive integration migration for blocks 20-22; no existing tables altered.
CREATE TABLE IF NOT EXISTS kosmora_account_preferences (
 owner_id TEXT PRIMARY KEY,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 relay_enabled INTEGER NOT NULL DEFAULT 0 CHECK (relay_enabled IN (0,1)),
 response_language TEXT NOT NULL DEFAULT 'ru' CHECK (response_language IN ('ru','en')),
 optimize_for TEXT NOT NULL DEFAULT 'balanced' CHECK (optimize_for IN ('balanced','quality','latency','cost')),
 preferred_provider TEXT,
 preferred_model TEXT,
 chat_style TEXT NOT NULL DEFAULT 'standard' CHECK (chat_style IN ('standard','concise','detailed')),
 max_total_tokens INTEGER CHECK (max_total_tokens IS NULL OR max_total_tokens >= 1),
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kosmora_chat_preferences (
 chat_id TEXT PRIMARY KEY REFERENCES general_chats(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 relay_enabled INTEGER NOT NULL CHECK (relay_enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS kosmora_relay_usage (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 chat_id TEXT,
 run_id TEXT NOT NULL,
 stage TEXT NOT NULL CHECK (stage IN ('to_en','from_en')),
 attempt INTEGER NOT NULL,
 provider_id TEXT NOT NULL,
 model_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('reserved','committed','uncertain')),
 reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
 input_tokens INTEGER,
 output_tokens INTEGER,
 created_at TEXT NOT NULL,
 UNIQUE(run_id,stage,attempt)
);
CREATE INDEX IF NOT EXISTS kosmora_relay_usage_owner_idx ON kosmora_relay_usage(owner_id,created_at);
CREATE TABLE IF NOT EXISTS kosmora_usage_holds (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 attempt INTEGER NOT NULL,
 max_tokens INTEGER NOT NULL CHECK (max_tokens >= 0),
 status TEXT NOT NULL CHECK (status IN ('reserved','uncertain')),
 created_at TEXT NOT NULL,
 UNIQUE(run_id,attempt)
);
CREATE INDEX IF NOT EXISTS kosmora_usage_holds_owner_idx ON kosmora_usage_holds(owner_id,status);
CREATE TABLE IF NOT EXISTS kosmora_data_delete_challenges (
 owner_id TEXT PRIMARY KEY,
 digest TEXT NOT NULL,
 expires_at TEXT NOT NULL
);

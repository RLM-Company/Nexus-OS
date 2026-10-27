ALTER TABLE general_chats ADD COLUMN mode TEXT NOT NULL DEFAULT 'kosmora' CHECK (mode IN ('kosmora','work','coscode'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_reasoning_preferences (owner_id TEXT PRIMARY KEY, effort TEXT CHECK (effort IN ('low','medium','high')));

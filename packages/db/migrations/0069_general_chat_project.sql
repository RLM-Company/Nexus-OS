ALTER TABLE general_chats ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE general_chats ADD COLUMN confidential INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX general_chats_project_updated_idx ON general_chats(project_id, updated_at DESC);

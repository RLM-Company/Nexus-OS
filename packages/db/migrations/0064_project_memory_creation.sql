ALTER TABLE project_memory ADD COLUMN creation_key TEXT;
--> statement-breakpoint
ALTER TABLE project_memory ADD COLUMN creation_sha256 TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX project_memory_creation_attempt ON project_memory(project_id, owner_id, creation_key) WHERE creation_key IS NOT NULL;

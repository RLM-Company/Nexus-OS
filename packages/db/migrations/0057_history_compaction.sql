-- Opt-in; existing settings and history stay unchanged.
ALTER TABLE context_memory_settings ADD COLUMN compact_history INTEGER NOT NULL DEFAULT 0
 CHECK(compact_history IN (0,1));

CREATE TABLE document_library_files (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('pdf','docx','txt','csv')),
  media_type TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 20000000),
  original BLOB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','ready','failed')),
  error_code TEXT,
  characters INTEGER NOT NULL DEFAULT 0,
  chunks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX document_library_files_owner ON document_library_files(project_id,owner_id,created_at);
--> statement-breakpoint
CREATE TABLE document_library_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL REFERENCES document_library_files(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  page INTEGER,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  content TEXT NOT NULL,
  UNIQUE(file_id,ordinal)
);
--> statement-breakpoint
CREATE VIRTUAL TABLE document_library_fts USING fts5(content, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER document_library_fts_delete AFTER DELETE ON document_library_chunks BEGIN
  DELETE FROM document_library_fts WHERE rowid=old.id;
END;

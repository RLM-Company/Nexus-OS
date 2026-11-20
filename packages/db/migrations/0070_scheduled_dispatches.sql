CREATE TABLE scheduled_dispatches (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  chat_id TEXT REFERENCES general_chats(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('message','work_task','koscode_task','team_task')),
  mode TEXT NOT NULL CHECK (mode IN ('once','daily','weekdays','weekly')),
  due_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','ready','dispatched','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, client_request_id)
);
--> statement-breakpoint
CREATE INDEX scheduled_dispatches_owner_due_idx ON scheduled_dispatches(owner_id, due_at, status);
--> statement-breakpoint
CREATE INDEX scheduled_dispatches_chat_idx ON scheduled_dispatches(chat_id, due_at);

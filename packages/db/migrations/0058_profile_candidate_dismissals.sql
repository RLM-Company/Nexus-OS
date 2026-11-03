-- Store only fingerprints and source references, never rejected text.
CREATE TABLE profile_candidate_dismissals (
 owner_id TEXT NOT NULL,
 candidate_id TEXT NOT NULL,
 chat_message_id TEXT REFERENCES general_chat_messages(id) ON DELETE CASCADE,
 project_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,candidate_id),
 CHECK((chat_message_id IS NULL) <> (project_message_id IS NULL))
);
--> statement-breakpoint
CREATE TRIGGER profile_candidate_dismissals_fence BEFORE INSERT ON profile_candidate_dismissals BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

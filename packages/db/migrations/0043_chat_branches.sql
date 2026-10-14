-- Branches are independent canonical chats with an immutable copied prefix.
-- Existing messages/runs/usage are never rewritten or duplicated in the ledger.
-- The newly queued model generation is billed normally.
CREATE TABLE chat_branches (
  chat_id TEXT PRIMARY KEY NOT NULL REFERENCES general_chats(id) ON DELETE CASCADE,
  parent_chat_id TEXT REFERENCES general_chats(id) ON DELETE SET NULL,
  root_chat_id TEXT REFERENCES general_chats(id) ON DELETE SET NULL,
  source_message_id TEXT REFERENCES general_chat_messages(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('edit','regenerate')),
  request_digest TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX chat_branches_root_idx ON chat_branches(root_chat_id);
--> statement-breakpoint
CREATE TRIGGER chat_branches_guard_insert BEFORE INSERT ON chat_branches BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN general_chats c ON c.owner_id=f.owner_id
    WHERE c.id=NEW.chat_id AND f.state<>'active'
  );
  SELECT RAISE(ABORT,'BRANCH_OWNER_MISMATCH') WHERE
    (SELECT owner_id FROM general_chats WHERE id=NEW.chat_id) IS NOT
    (SELECT owner_id FROM general_chats WHERE id=NEW.parent_chat_id)
    OR (SELECT owner_id FROM general_chats WHERE id=NEW.chat_id) IS NOT
    (SELECT owner_id FROM general_chats WHERE id=NEW.root_chat_id)
    OR NOT EXISTS (SELECT 1 FROM general_chat_messages WHERE id=NEW.source_message_id AND chat_id=NEW.parent_chat_id);
END;

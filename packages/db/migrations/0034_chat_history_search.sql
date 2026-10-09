-- Derived FTS5 index over canonical chat/project stores. No new history or owner grants.
-- Migrations only: never run this DDL at API startup.
CREATE VIRTUAL TABLE chat_history_fts USING fts5(
  kind UNINDEXED, source_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint

CREATE TRIGGER general_chats_search_insert AFTER INSERT ON general_chats WHEN 1 BEGIN
 INSERT INTO chat_history_fts(rowid,kind,source_id,title,body) VALUES (NEW.rowid*4+0, 'general_title', NEW.id, NEW.title, '');
END;
--> statement-breakpoint

CREATE TRIGGER general_chats_search_delete AFTER DELETE ON general_chats BEGIN
 DELETE FROM chat_history_fts WHERE rowid=OLD.rowid*4+0;
END;
--> statement-breakpoint

CREATE TRIGGER general_chats_search_update AFTER UPDATE OF title ON general_chats BEGIN
 DELETE FROM chat_history_fts WHERE rowid=OLD.rowid*4+0;
 INSERT INTO chat_history_fts(rowid,kind,source_id,title,body)
 SELECT NEW.rowid*4+0, 'general_title', NEW.id, NEW.title, ''
 WHERE 1;
END;
--> statement-breakpoint

CREATE TRIGGER general_chat_messages_search_insert AFTER INSERT ON general_chat_messages
 WHEN NEW.content <> '' AND (NEW.role='user' OR NEW.status IN ('completed','failed','cancelled')) BEGIN
 INSERT INTO chat_history_fts(rowid,kind,source_id,title,body) VALUES (NEW.rowid*4+1, 'general_message', NEW.id, '', NEW.content);
END;
--> statement-breakpoint

CREATE TRIGGER general_chat_messages_search_delete AFTER DELETE ON general_chat_messages BEGIN
 DELETE FROM chat_history_fts WHERE rowid=OLD.rowid*4+1;
END;
--> statement-breakpoint

CREATE TRIGGER general_chat_messages_search_update AFTER UPDATE OF content, status ON general_chat_messages
 WHEN NOT (OLD.role='assistant' AND NEW.role='assistant' AND OLD.status='streaming' AND NEW.status='streaming') BEGIN
 DELETE FROM chat_history_fts WHERE rowid=OLD.rowid*4+1;
 INSERT INTO chat_history_fts(rowid,kind,source_id,title,body)
 SELECT NEW.rowid*4+1, 'general_message', NEW.id, '', NEW.content
 WHERE NEW.content <> '' AND (NEW.role='user' OR NEW.status IN ('completed','failed','cancelled'));
END;
--> statement-breakpoint

CREATE TRIGGER projects_search_insert AFTER INSERT ON projects WHEN 1 BEGIN
 INSERT INTO chat_history_fts(rowid,kind,source_id,title,body) VALUES (NEW.rowid*4+2, 'project_title', NEW.id, NEW.title, '');
END;
--> statement-breakpoint

CREATE TRIGGER projects_search_delete AFTER DELETE ON projects BEGIN
 DELETE FROM chat_history_fts WHERE rowid=OLD.rowid*4+2;
END;
--> statement-breakpoint

CREATE TRIGGER projects_search_update AFTER UPDATE OF title ON projects BEGIN
 DELETE FROM chat_history_fts WHERE rowid=OLD.rowid*4+2;
 INSERT INTO chat_history_fts(rowid,kind,source_id,title,body)
 SELECT NEW.rowid*4+2, 'project_title', NEW.id, NEW.title, ''
 WHERE 1;
END;
--> statement-breakpoint

CREATE TRIGGER messages_search_insert AFTER INSERT ON messages
 WHEN NEW.content <> '' AND (NEW.role='user' OR (NEW.role='assistant' AND NEW.status IN ('completed','failed','cancelled'))) BEGIN
 INSERT INTO chat_history_fts(rowid,kind,source_id,title,body) VALUES (NEW.rowid*4+3, 'project_message', NEW.id, '', NEW.content);
END;
--> statement-breakpoint

CREATE TRIGGER messages_search_delete AFTER DELETE ON messages BEGIN
 DELETE FROM chat_history_fts WHERE rowid=OLD.rowid*4+3;
END;
--> statement-breakpoint

CREATE TRIGGER messages_search_update AFTER UPDATE OF content, role, status ON messages
 WHEN NOT (OLD.role='assistant' AND NEW.role='assistant' AND OLD.status='streaming' AND NEW.status='streaming') BEGIN
 DELETE FROM chat_history_fts WHERE rowid=OLD.rowid*4+3;
 INSERT INTO chat_history_fts(rowid,kind,source_id,title,body)
 SELECT NEW.rowid*4+3, 'project_message', NEW.id, '', NEW.content
 WHERE NEW.content <> '' AND (NEW.role='user' OR (NEW.role='assistant' AND NEW.status IN ('completed','failed','cancelled')));
END;
--> statement-breakpoint

INSERT INTO chat_history_fts(rowid,kind,source_id,title,body) SELECT rowid*4+0, 'general_title', id, title, '' FROM general_chats ;
--> statement-breakpoint

INSERT INTO chat_history_fts(rowid,kind,source_id,title,body) SELECT rowid*4+1, 'general_message', id, '', content FROM general_chat_messages WHERE content <> '' AND (role='user' OR status IN ('completed','failed','cancelled'));
--> statement-breakpoint

INSERT INTO chat_history_fts(rowid,kind,source_id,title,body) SELECT rowid*4+2, 'project_title', id, title, '' FROM projects ;
--> statement-breakpoint

INSERT INTO chat_history_fts(rowid,kind,source_id,title,body) SELECT rowid*4+3, 'project_message', id, '', content FROM messages WHERE content <> '' AND (role='user' OR (role='assistant' AND status IN ('completed','failed','cancelled')));
--> statement-breakpoint

--> statement-breakpoint

CREATE TRIGGER kosmora_privacy_document_answer_runs_insert BEFORE INSERT ON document_answer_runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_document_answer_runs_update BEFORE UPDATE ON document_answer_runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

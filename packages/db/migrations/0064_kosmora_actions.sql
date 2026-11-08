-- Kosmora explicit actions: web search and text actions live on the canonical
-- user message. The stored content stays the owner's original text; the model
-- sees only a dispatch-time rendering, never a rewritten stored message.
ALTER TABLE general_chat_messages ADD COLUMN web_search INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE general_chat_messages ADD COLUMN text_action_json TEXT;

CREATE TABLE `general_chat_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `general_chat_folders_owner_idx` ON `general_chat_folders` (`owner_id`, `name`);
--> statement-breakpoint
ALTER TABLE `general_chats` ADD COLUMN `folder_id` text REFERENCES `general_chat_folders`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `general_chats` ADD COLUMN `pinned` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `general_chats` ADD COLUMN `pinned_order` integer DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `general_chats` ADD COLUMN `active_branch_id` text NOT NULL DEFAULT 'main';
--> statement-breakpoint
ALTER TABLE `general_chat_messages` ADD COLUMN `parent_message_id` text REFERENCES `general_chat_messages`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `general_chat_messages` ADD COLUMN `branch_id` text NOT NULL DEFAULT 'main';
--> statement-breakpoint
ALTER TABLE `general_chat_messages` ADD COLUMN `version_index` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `general_chat_messages` ADD COLUMN `excluded_from_context` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `general_chat_messages_parent_idx` ON `general_chat_messages` (`chat_id`, `parent_message_id`);
--> statement-breakpoint
CREATE INDEX `general_chat_messages_branch_idx` ON `general_chat_messages` (`chat_id`, `branch_id`);
--> statement-breakpoint
CREATE TABLE `general_chat_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`branch_id` text NOT NULL DEFAULT 'main',
	`owner_id` text NOT NULL,
	`memory_notes` text NOT NULL DEFAULT '',
	`summary` text NOT NULL DEFAULT '',
	`summary_up_to_message_id` text,
	`summary_invalidated` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `general_chats`(`id`) ON DELETE CASCADE,
	CONSTRAINT `general_chat_memory_chat_branch_unique` UNIQUE (`chat_id`, `branch_id`, `owner_id`)
);
--> statement-breakpoint
CREATE TABLE `general_chat_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`branch_id` text NOT NULL DEFAULT 'main',
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`language` text,
	`content` text NOT NULL,
	`version` integer NOT NULL DEFAULT 1,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `general_chats`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`message_id`) REFERENCES `general_chat_messages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `general_chat_artifacts_chat_idx` ON `general_chat_artifacts` (`chat_id`, `owner_id`);
--> statement-breakpoint
CREATE TABLE `general_chat_artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `general_chat_artifacts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `general_chat_artifact_versions_unique` UNIQUE (`artifact_id`, `version`)
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `general_chat_fts` USING fts5(
	chat_id UNINDEXED,
	message_id UNINDEXED,
	owner_id UNINDEXED,
	title,
	content,
	tokenize = 'unicode61'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `general_chats_ai` AFTER INSERT ON `general_chats` BEGIN
	INSERT INTO `general_chat_fts` (`chat_id`, `message_id`, `owner_id`, `title`, `content`)
	VALUES (new.id, '', new.owner_id, new.title, '');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `general_chats_au` AFTER UPDATE OF `title` ON `general_chats` BEGIN
	UPDATE `general_chat_fts` SET `title` = new.title
	WHERE `chat_id` = new.id AND `message_id` = '';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `general_chats_ad` AFTER DELETE ON `general_chats` BEGIN
	DELETE FROM `general_chat_fts` WHERE `chat_id` = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `general_chat_messages_ai` AFTER INSERT ON `general_chat_messages` BEGIN
	INSERT INTO `general_chat_fts` (`chat_id`, `message_id`, `owner_id`, `title`, `content`)
	VALUES (new.chat_id, new.id, (SELECT `owner_id` FROM `general_chats` WHERE `id` = new.chat_id), '', new.content);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `general_chat_messages_au` AFTER UPDATE OF `content` ON `general_chat_messages` BEGIN
	UPDATE `general_chat_fts` SET `content` = new.content
	WHERE `message_id` = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `general_chat_messages_ad` AFTER DELETE ON `general_chat_messages` BEGIN
	DELETE FROM `general_chat_fts` WHERE `message_id` = old.id;
END;

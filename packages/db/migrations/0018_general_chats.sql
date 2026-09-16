CREATE TABLE `general_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `general_chats_id_owner_unique` ON `general_chats` (`id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `general_chats_owner_updated_idx` ON `general_chats` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `general_chat_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`status` text NOT NULL,
	`provider` text,
	`model_resolved` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `general_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `general_chat_runs_status_check` CHECK(`status` IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `general_chat_runs_chat_created_idx` ON `general_chat_runs` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `general_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`content_type` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`client_message_id` text,
	`run_id` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `general_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `general_chat_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `general_chat_messages_role_check` CHECK(`role` IN ('user', 'assistant')),
	CONSTRAINT `general_chat_messages_status_check` CHECK(`status` IN ('pending', 'streaming', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `general_chat_messages_chat_created_idx` ON `general_chat_messages` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `general_chat_messages_owner_client_unique` ON `general_chat_messages` (`owner_id`,`client_message_id`);--> statement-breakpoint
CREATE TABLE `general_chat_model_usage` (
	`usage_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`registry_version` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_requested` text NOT NULL,
	`model_resolved` text,
	`estimated_input_tokens` integer NOT NULL,
	`max_output_tokens` integer NOT NULL,
	`estimated_cost_amount` real,
	`actual_input_tokens` integer,
	`actual_output_tokens` integer,
	`calculated_cost_amount` real,
	`currency` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `general_chat_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `general_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `general_chat_model_usage_status_check` CHECK(`status` IN ('reserved', 'committed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `general_chat_model_usage_run_attempt_unique` ON `general_chat_model_usage` (`run_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `general_chat_model_usage_chat_created_idx` ON `general_chat_model_usage` (`chat_id`,`created_at`);

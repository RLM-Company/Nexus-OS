CREATE TABLE `autonomy_profiles` (
	`project_id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`base_level` text NOT NULL,
	`version` integer NOT NULL,
	`profile_json` text NOT NULL,
	`issued_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `autonomy_profiles_profile_id_unique` ON `autonomy_profiles` (`profile_id`);--> statement-breakpoint
CREATE TABLE `confirmation_requests` (
	`confirmation_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`intent_json` text NOT NULL,
	`verdict_json` text NOT NULL,
	`challenge_nonce` text NOT NULL,
	`requires_step_up` integer NOT NULL,
	`requested_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`decision_reason` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `confirmation_requests_operation_id_unique` ON `confirmation_requests` (`operation_id`);--> statement-breakpoint
CREATE INDEX `confirmation_requests_project_status_idx` ON `confirmation_requests` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `permission_contracts` (
	`permission_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`state` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text,
	`operations_limit` integer,
	`operations_used` integer DEFAULT 0 NOT NULL,
	`contract_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `permission_contracts_lookup_idx` ON `permission_contracts` (`project_id`,`subject_id`,`state`,`valid_until`);--> statement-breakpoint
CREATE TABLE `policy_decisions` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`project_id` text NOT NULL,
	`verdict` text NOT NULL,
	`intent_json` text NOT NULL,
	`verdict_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `policy_decisions_operation_idx` ON `policy_decisions` (`operation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `policy_operations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`intent_json` text NOT NULL,
	`verdict_json` text NOT NULL,
	`confirmation_id` text,
	`result_json` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmation_id`) REFERENCES `confirmation_requests`(`confirmation_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policy_operations_project_idempotency_unique` ON `policy_operations` (`project_id`,`idempotency_key`);
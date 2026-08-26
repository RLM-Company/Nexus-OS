CREATE TABLE `model_usage_ledger` (
	`usage_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
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
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_usage_ledger_run_attempt_unique` ON `model_usage_ledger` (`run_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `model_usage_ledger_project_created_idx` ON `model_usage_ledger` (`project_id`,`created_at`);
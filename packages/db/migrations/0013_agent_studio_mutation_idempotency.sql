CREATE TABLE `agent_studio_mutations` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`operation_type` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_id` text NOT NULL,
	`result_version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`owner_id`) REFERENCES `projects`(`id`,`owner_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_studio_mutations_result_version_check" CHECK("agent_studio_mutations"."result_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_studio_mutations_owner_project_key_unique` ON `agent_studio_mutations` (`owner_id`,`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_studio_mutations_owner_project_created_idx` ON `agent_studio_mutations` (`owner_id`,`project_id`,`created_at`);
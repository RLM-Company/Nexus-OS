CREATE TABLE `manager_demo_runs` (
	`demo_run_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_run_id` text NOT NULL,
	`owner_goal` text NOT NULL,
	`graph_json` text NOT NULL,
	`status` text NOT NULL,
	`checkpoint_json` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `manager_demo_runs_status_check` CHECK(`manager_demo_runs`.`status` IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manager_demo_runs_owner_source_unique` ON `manager_demo_runs` (`owner_id`,`source_run_id`);--> statement-breakpoint
CREATE INDEX `manager_demo_runs_project_created_idx` ON `manager_demo_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `manager_demo_artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`demo_run_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`demo_run_id`) REFERENCES `manager_demo_runs`(`demo_run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `manager_demo_artifacts_kind_check` CHECK(`manager_demo_artifacts`.`kind` IN ('plan', 'analysis', 'handoff', 'checkpoint'))
);
--> statement-breakpoint
CREATE INDEX `manager_demo_artifacts_run_created_idx` ON `manager_demo_artifacts` (`demo_run_id`,`created_at`);

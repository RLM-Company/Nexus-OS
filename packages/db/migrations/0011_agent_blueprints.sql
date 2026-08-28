CREATE UNIQUE INDEX `projects_id_owner_unique` ON `projects` (`id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `agent_blueprints` (
	`blueprint_id` text NOT NULL,
	`version` integer NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`function_id` text NOT NULL,
	`function_version` integer NOT NULL,
	`pattern_id` text NOT NULL,
	`pattern_version` integer NOT NULL,
	`model_profile_id` text NOT NULL,
	`model_profile_version` integer NOT NULL,
	`grant_json` text NOT NULL,
	`memory_scope_json` text NOT NULL,
	`task_contract` text NOT NULL,
	`start_condition` text NOT NULL,
	`close_conditions_json` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`blueprint_id`, `version`),
	FOREIGN KEY (`project_id`,`owner_id`) REFERENCES `projects`(`id`,`owner_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`function_id`,`function_version`) REFERENCES `agent_function_definitions`(`function_id`,`version`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`pattern_id`,`pattern_version`) REFERENCES `behavior_patterns`(`pattern_id`,`version`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agent_blueprints_owner_project_idx` ON `agent_blueprints` (`owner_id`,`project_id`,`blueprint_id`,`version`);

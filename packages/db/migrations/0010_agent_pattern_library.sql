CREATE TABLE `agent_function_definitions` (
	`function_id` text NOT NULL,
	`version` integer NOT NULL,
	`scope` text NOT NULL,
	`owner_id` text,
	`project_id` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`result_contract` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`function_id`, `version`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_functions_scope_binding_check" CHECK(("agent_function_definitions"."scope" = 'product' AND "agent_function_definitions"."owner_id" IS NULL AND "agent_function_definitions"."project_id" IS NULL)
          OR ("agent_function_definitions"."scope" = 'owner' AND "agent_function_definitions"."owner_id" IS NOT NULL AND "agent_function_definitions"."project_id" IS NULL)
          OR ("agent_function_definitions"."scope" = 'project' AND "agent_function_definitions"."owner_id" IS NOT NULL AND "agent_function_definitions"."project_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `agent_functions_visibility_idx` ON `agent_function_definitions` (`scope`,`owner_id`,`project_id`,`function_id`,`version`);--> statement-breakpoint
CREATE TABLE `behavior_patterns` (
	`pattern_id` text NOT NULL,
	`version` integer NOT NULL,
	`scope` text NOT NULL,
	`owner_id` text,
	`project_id` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`instructions` text NOT NULL,
	`allowed_function_ids_json` text NOT NULL,
	`known_limitations_json` text NOT NULL,
	`test_status` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	PRIMARY KEY(`pattern_id`, `version`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "behavior_patterns_scope_binding_check" CHECK(("behavior_patterns"."scope" = 'product' AND "behavior_patterns"."owner_id" IS NULL AND "behavior_patterns"."project_id" IS NULL)
          OR ("behavior_patterns"."scope" = 'owner' AND "behavior_patterns"."owner_id" IS NOT NULL AND "behavior_patterns"."project_id" IS NULL)
          OR ("behavior_patterns"."scope" = 'project' AND "behavior_patterns"."owner_id" IS NOT NULL AND "behavior_patterns"."project_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `behavior_patterns_visibility_idx` ON `behavior_patterns` (`scope`,`owner_id`,`project_id`,`pattern_id`,`version`);

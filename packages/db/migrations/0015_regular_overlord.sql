CREATE TABLE `project_usage_limits` (
	`project_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`version` integer NOT NULL,
	`max_total_tokens` integer,
	`max_cost_amount` real,
	`currency` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`owner_id`) REFERENCES `projects`(`id`,`owner_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_usage_limits_version_check" CHECK("project_usage_limits"."version" >= 1),
	CONSTRAINT "project_usage_limits_token_check" CHECK("project_usage_limits"."max_total_tokens" IS NULL OR "project_usage_limits"."max_total_tokens" >= 1),
	CONSTRAINT "project_usage_limits_cost_check" CHECK(("project_usage_limits"."max_cost_amount" IS NULL AND "project_usage_limits"."currency" IS NULL)
          OR ("project_usage_limits"."max_cost_amount" > 0 AND "project_usage_limits"."currency" IN ('USD', 'RUB')))
);

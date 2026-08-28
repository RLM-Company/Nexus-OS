CREATE TABLE `agent_instances` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`blueprint_id` text NOT NULL,
	`blueprint_version` integer NOT NULL,
	`parent_instance_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`blueprint_id`,`blueprint_version`,`owner_id`,`project_id`) REFERENCES `agent_blueprints`(`blueprint_id`,`version`,`owner_id`,`project_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_instance_id`,`owner_id`,`project_id`) REFERENCES `agent_instances`(`instance_id`,`owner_id`,`project_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_instances_proposed_only_check" CHECK("agent_instances"."status" = 'proposed' AND "agent_instances"."closed_at" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_instances_binding_unique` ON `agent_instances` (`instance_id`,`owner_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `agent_instances_owner_project_status_idx` ON `agent_instances` (`owner_id`,`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_blueprints_binding_unique` ON `agent_blueprints` (`blueprint_id`,`version`,`owner_id`,`project_id`);

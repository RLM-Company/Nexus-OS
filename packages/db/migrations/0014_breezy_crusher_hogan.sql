CREATE TABLE `agent_studio_decision_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`object_version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`owner_id`) REFERENCES `projects`(`id`,`owner_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_studio_decision_events_object_version_check" CHECK("agent_studio_decision_events"."object_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `agent_studio_decision_events_owner_project_created_idx` ON `agent_studio_decision_events` (`owner_id`,`project_id`,`created_at`);
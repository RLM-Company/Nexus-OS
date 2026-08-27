CREATE TABLE `emergency_stops` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`active` integer NOT NULL,
	`reason` text NOT NULL,
	`activated_at` text NOT NULL,
	`activated_by` text NOT NULL,
	`cleared_at` text,
	`cleared_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `emergency_stops_scope_active_idx` ON `emergency_stops` (`scope`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `emergency_stops_project_unique` ON `emergency_stops` (`project_id`);
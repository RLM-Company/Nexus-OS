CREATE TABLE `emergency_stop_clearance_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`activation_reason` text NOT NULL,
	`activated_at` text NOT NULL,
	`activated_by` text NOT NULL,
	`clearance_reason` text NOT NULL,
	`cleared_at` text NOT NULL,
	`cleared_by` text NOT NULL,
	CONSTRAINT "emergency_stop_clearance_scope_check" CHECK("emergency_stop_clearance_events"."scope" IN ('process', 'project')),
	CONSTRAINT "emergency_stop_clearance_project_check" CHECK(("emergency_stop_clearance_events"."scope" = 'process' AND "emergency_stop_clearance_events"."scope_key" = 'process' AND "emergency_stop_clearance_events"."project_id" IS NULL)
          OR ("emergency_stop_clearance_events"."scope" = 'project' AND "emergency_stop_clearance_events"."scope_key" = 'project:' || "emergency_stop_clearance_events"."project_id"
              AND "emergency_stop_clearance_events"."project_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emergency_stop_clearance_scope_activation_unique` ON `emergency_stop_clearance_events` (`scope_key`,`activated_at`);--> statement-breakpoint
CREATE INDEX `emergency_stop_clearance_owner_cleared_idx` ON `emergency_stop_clearance_events` (`owner_id`,`cleared_at`);--> statement-breakpoint
CREATE TRIGGER `emergency_stop_clearance_events_no_update`
BEFORE UPDATE ON `emergency_stop_clearance_events`
BEGIN
	SELECT RAISE(ABORT, 'emergency-stop clearance audit is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `emergency_stop_clearance_events_no_delete`
BEFORE DELETE ON `emergency_stop_clearance_events`
BEGIN
	SELECT RAISE(ABORT, 'emergency-stop clearance audit is append-only');
END;

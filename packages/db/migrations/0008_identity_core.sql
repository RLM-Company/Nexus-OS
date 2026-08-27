CREATE TABLE `identity_actors` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `identity_actors_owner_status_idx` ON `identity_actors` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `identity_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`assurance` text NOT NULL,
	`status` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text,
	`revoke_reason` text,
	FOREIGN KEY (`actor_id`) REFERENCES `identity_actors`(`actor_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_sessions_token_hash_unique` ON `identity_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `identity_sessions_owner_status_expires_idx` ON `identity_sessions` (`owner_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `identity_sessions_actor_status_idx` ON `identity_sessions` (`actor_id`,`status`);--> statement-breakpoint
CREATE TABLE `identity_audit_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`session_id` text,
	`event_type` text NOT NULL,
	`outcome` text NOT NULL,
	`reason_code` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `identity_sessions`(`session_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `identity_audit_owner_created_idx` ON `identity_audit_events` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `identity_audit_session_created_idx` ON `identity_audit_events` (`session_id`,`created_at`);
CREATE TABLE `step_up_proofs` (
	`proof_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`session_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`challenge_hash` text NOT NULL,
	`status` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `identity_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_up_proofs_token_hash_unique` ON `step_up_proofs` (`token_hash`);--> statement-breakpoint
CREATE INDEX `step_up_proofs_owner_status_expires_idx` ON `step_up_proofs` (`owner_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `step_up_proofs_session_status_idx` ON `step_up_proofs` (`session_id`,`status`);

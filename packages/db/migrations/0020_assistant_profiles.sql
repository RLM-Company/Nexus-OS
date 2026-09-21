CREATE TABLE `assistant_profiles` (
	`id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`id`, `owner_id`)
);
--> statement-breakpoint
CREATE INDEX `assistant_profiles_owner_updated_idx` ON `assistant_profiles` (`owner_id`,`updated_at`);

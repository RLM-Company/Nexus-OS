ALTER TABLE `assistant_profiles` ADD `avatar` text;
--> statement-breakpoint
ALTER TABLE `assistant_profiles` ADD `starter_prompts_json` text DEFAULT '[]' NOT NULL;

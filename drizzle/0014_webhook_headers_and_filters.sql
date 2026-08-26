ALTER TABLE `webhook` ADD `headers` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `webhook` ADD `filter` text;
CREATE TABLE `issue_subscriber` (
	`id` text PRIMARY KEY NOT NULL,
	`issueId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issueId`) REFERENCES `issue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_subscriber_unique` ON `issue_subscriber` (`issueId`,`userId`);--> statement-breakpoint
CREATE INDEX `issue_subscriber_user` ON `issue_subscriber` (`userId`);--> statement-breakpoint
ALTER TABLE `team` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `team` ADD `color` text;
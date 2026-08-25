CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`submitterName` text,
	`submitterEmail` text,
	`submitterUserId` text,
	`source` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitterUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_number_unique` ON `feedback` (`workspaceId`,`number`);--> statement-breakpoint
CREATE INDEX `feedback_workspace_status` ON `feedback` (`workspaceId`,`status`);--> statement-breakpoint
CREATE INDEX `feedback_public` ON `feedback` (`workspaceId`,`visibility`,`createdAt`);--> statement-breakpoint
CREATE TABLE `feedback_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`feedbackId` text NOT NULL,
	`authorId` text NOT NULL,
	`body` text NOT NULL,
	`internal` integer DEFAULT false NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_comment_feedback` ON `feedback_comment` (`feedbackId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `feedback_label` (
	`feedbackId` text NOT NULL,
	`labelId` text NOT NULL,
	PRIMARY KEY(`feedbackId`, `labelId`),
	FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`labelId`) REFERENCES `label`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feedback_subscriber` (
	`id` text PRIMARY KEY NOT NULL,
	`feedbackId` text NOT NULL,
	`email` text NOT NULL,
	`userId` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_subscriber_unique` ON `feedback_subscriber` (`feedbackId`,`email`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`resetAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_reset` ON `rate_limit` (`resetAt`);--> statement-breakpoint
ALTER TABLE `issue` ADD `feedbackId` text REFERENCES feedback(id);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_feedback_unique` ON `issue` (`feedbackId`);--> statement-breakpoint
ALTER TABLE `workspace` ADD `feedbackIntake` text DEFAULT 'api_key' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `feedbackBoard` text DEFAULT 'private' NOT NULL;
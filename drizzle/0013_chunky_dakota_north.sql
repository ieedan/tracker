CREATE TABLE `issue_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`issueId` text NOT NULL,
	`actorId` text NOT NULL,
	`type` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issueId`) REFERENCES `issue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_activity_issue` ON `issue_activity` (`issueId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `issue_template` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`teamId` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`assigneeId` text,
	`createdBy` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigneeId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_template_workspace` ON `issue_template` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `issue_template_team` ON `issue_template` (`teamId`);--> statement-breakpoint
CREATE TABLE `issue_template_label` (
	`templateId` text NOT NULL,
	`labelId` text NOT NULL,
	PRIMARY KEY(`templateId`, `labelId`),
	FOREIGN KEY (`templateId`) REFERENCES `issue_template`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`labelId`) REFERENCES `label`(`id`) ON UPDATE no action ON DELETE cascade
);

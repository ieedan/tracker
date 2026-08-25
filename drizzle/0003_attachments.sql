CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`key` text NOT NULL,
	`filename` text NOT NULL,
	`contentType` text NOT NULL,
	`size` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`uploadedBy` text NOT NULL,
	`issueId` text,
	`commentId` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploadedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issueId`) REFERENCES `issue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`commentId`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_key_unique` ON `attachment` (`key`);--> statement-breakpoint
CREATE INDEX `attachment_issue` ON `attachment` (`issueId`);--> statement-breakpoint
CREATE INDEX `attachment_comment` ON `attachment` (`commentId`);--> statement-breakpoint
CREATE INDEX `attachment_workspace` ON `attachment` (`workspaceId`);
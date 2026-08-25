CREATE TABLE `provider_installation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`provider` text NOT NULL,
	`externalId` text NOT NULL,
	`account` text DEFAULT '' NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installation_unique` ON `provider_installation` (`workspaceId`,`provider`,`externalId`);--> statement-breakpoint
CREATE INDEX `installation_workspace` ON `provider_installation` (`workspaceId`);--> statement-breakpoint
CREATE TABLE `pull_request` (
	`id` text PRIMARY KEY NOT NULL,
	`issueId` text NOT NULL,
	`repositoryId` text NOT NULL,
	`externalId` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`url` text NOT NULL,
	`authorLogin` text DEFAULT '' NOT NULL,
	`remoteUpdatedAt` integer,
	`syncedAt` integer,
	`linkedBy` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issueId`) REFERENCES `issue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repositoryId`) REFERENCES `repository`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linkedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pull_request_issue_unique` ON `pull_request` (`issueId`);--> statement-breakpoint
CREATE UNIQUE INDEX `pull_request_unique` ON `pull_request` (`repositoryId`,`number`);--> statement-breakpoint
CREATE TABLE `repository` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`installationId` text NOT NULL,
	`provider` text NOT NULL,
	`externalId` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`defaultBranch` text DEFAULT 'main' NOT NULL,
	`private` integer DEFAULT true NOT NULL,
	`url` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`indexState` text DEFAULT 'never' NOT NULL,
	`indexRef` text DEFAULT '' NOT NULL,
	`indexedFileCount` integer DEFAULT 0 NOT NULL,
	`indexTruncated` integer DEFAULT false NOT NULL,
	`indexedAt` integer,
	`indexError` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installationId`) REFERENCES `provider_installation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_unique` ON `repository` (`workspaceId`,`provider`,`externalId`);--> statement-breakpoint
CREATE INDEX `repository_workspace` ON `repository` (`workspaceId`);--> statement-breakpoint
CREATE TABLE `repository_file` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryId` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`repositoryId`) REFERENCES `repository`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_file_unique` ON `repository_file` (`repositoryId`,`path`);--> statement-breakpoint
CREATE INDEX `repository_file_name` ON `repository_file` (`repositoryId`,`name`);--> statement-breakpoint
ALTER TABLE `issue` ADD `repositoryId` text REFERENCES repository(id);--> statement-breakpoint
CREATE INDEX `issue_repository` ON `issue` (`repositoryId`);
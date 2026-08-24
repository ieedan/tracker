-- Teams own issues; a workspace is the container.
--
-- Written by hand rather than generated, because the generated version answers
-- "is issue.workspaceId a rename of issue.teamId?" by dropping the column and
-- every issue with it. Existing data is preserved instead: each workspace's old
-- `key` becomes its first team, and that workspace's issues move onto it — so
-- every existing identifier (ENG-42 and friends) still resolves afterwards.

CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_key_unique` ON `team` (`workspaceId`,`key`);--> statement-breakpoint
CREATE INDEX `team_workspace` ON `team` (`workspaceId`);--> statement-breakpoint

-- One team per existing workspace, carrying that workspace's old prefix so no
-- identifier changes. The old model had no team name, so it inherits the
-- workspace's — which is what that prefix was named after anyway.
INSERT INTO `team` (`id`, `workspaceId`, `name`, `key`, `createdAt`)
SELECT lower(hex(randomblob(16))), `id`, `name`, `key`, `createdAt`
FROM `workspace`;--> statement-breakpoint

-- Every workspace also gains the second default team, unless its old prefix
-- already happened to be PRD.
INSERT INTO `team` (`id`, `workspaceId`, `name`, `key`, `createdAt`)
SELECT lower(hex(randomblob(16))), `id`, 'Product', 'PRD', `createdAt`
FROM `workspace`
WHERE `key` <> 'PRD';--> statement-breakpoint

-- SQLite cannot swap a foreign key in place, so `issue` is rebuilt.
CREATE TABLE `__new_issue` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`assigneeId` text,
	`creatorId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigneeId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`creatorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- Numbers are unique per team and each workspace's issues all land on that
-- workspace's single migrated team, so they stay unique and unchanged.
INSERT INTO `__new_issue` (
	`id`, `teamId`, `number`, `title`, `description`,
	`status`, `priority`, `assigneeId`, `creatorId`, `createdAt`, `updatedAt`
)
SELECT
	`issue`.`id`,
	`team`.`id`,
	`issue`.`number`,
	`issue`.`title`,
	`issue`.`description`,
	`issue`.`status`,
	`issue`.`priority`,
	`issue`.`assigneeId`,
	`issue`.`creatorId`,
	`issue`.`createdAt`,
	`issue`.`updatedAt`
FROM `issue`
JOIN `workspace` ON `workspace`.`id` = `issue`.`workspaceId`
JOIN `team` ON `team`.`workspaceId` = `workspace`.`id` AND `team`.`key` = `workspace`.`key`;--> statement-breakpoint

DROP TABLE `issue`;--> statement-breakpoint
ALTER TABLE `__new_issue` RENAME TO `issue`;--> statement-breakpoint
CREATE UNIQUE INDEX `issue_number_unique` ON `issue` (`teamId`,`number`);--> statement-breakpoint
CREATE INDEX `issue_team` ON `issue` (`teamId`);--> statement-breakpoint
CREATE INDEX `issue_assignee` ON `issue` (`assigneeId`);--> statement-breakpoint

-- The prefix now lives on the team, so the workspace no longer carries one.
ALTER TABLE `workspace` DROP COLUMN `key`;

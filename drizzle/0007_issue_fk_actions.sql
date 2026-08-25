-- Rebuilds `issue` so its two nullable foreign keys carry ON DELETE SET NULL.
--
-- Hand-written, because `drizzle-kit generate` drops the referential action
-- when a column is added: migrations 0004 and 0006 emitted
--   ALTER TABLE `issue` ADD `feedbackId` text REFERENCES feedback(id);
-- rather than `... REFERENCES feedback(id) ON DELETE SET NULL`. SQLite defaults
-- an omitted action to NO ACTION, so deleting a piece of feedback that had been
-- converted, or unlinking a repository that any issue referenced, failed with
-- FOREIGN KEY constraint failed. The schema said one thing and the database
-- did another.
--
-- SQLite cannot alter a constraint in place, so this is the documented
-- table-rebuild: create, copy, drop, rename, recreate indexes.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

CREATE TABLE `issue_rebuilt` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`assigneeId` text,
	`creatorId` text NOT NULL,
	`feedbackId` text,
	`repositoryId` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigneeId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`creatorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`repositoryId`) REFERENCES `repository`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint

INSERT INTO `issue_rebuilt` (
	`id`, `teamId`, `number`, `title`, `description`, `status`, `priority`,
	`assigneeId`, `creatorId`, `feedbackId`, `repositoryId`, `createdAt`, `updatedAt`
)
SELECT
	`id`, `teamId`, `number`, `title`, `description`, `status`, `priority`,
	`assigneeId`, `creatorId`, `feedbackId`, `repositoryId`, `createdAt`, `updatedAt`
FROM `issue`;--> statement-breakpoint

DROP TABLE `issue`;--> statement-breakpoint
ALTER TABLE `issue_rebuilt` RENAME TO `issue`;--> statement-breakpoint

CREATE UNIQUE INDEX `issue_number_unique` ON `issue` (`teamId`,`number`);--> statement-breakpoint
CREATE INDEX `issue_team` ON `issue` (`teamId`);--> statement-breakpoint
CREATE INDEX `issue_assignee` ON `issue` (`assigneeId`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_feedback_unique` ON `issue` (`feedbackId`);--> statement-breakpoint
CREATE INDEX `issue_repository` ON `issue` (`repositoryId`);--> statement-breakpoint

PRAGMA foreign_keys=ON;

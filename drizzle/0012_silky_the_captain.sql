-- Moves agent authorization from the workspace to the person.
--
-- A grant used to name one workspace; now it names none, and an agent reaches
-- whatever its approver can. Two consequences are migrated here:
--
--   * `agent_grant` carries the harness itself, copied off the identity it used
--     to point at, so a token still resolves to the right bot.
--   * bots collapse from one per (harness, workspace) to one per harness. Every
--     reference to a duplicate is repointed at the survivor before it is
--     deleted, so no comment, issue or notification is orphaned.
--
-- Hand-written: the generated version dropped `agentIdentityId` before anything
-- could read the harness off it, and `ADD COLUMN ... NOT NULL` fails on a table
-- that already has rows.
--
-- table-rebuild: create, copy, drop, rename, recreate indexes.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- The bot that survives for each harness: the earliest, so the choice is stable
-- if this ever runs twice.
CREATE TEMP TABLE `agent_merge` AS
SELECT u.`id` AS `from`, (
	SELECT s.`id` FROM `user` s
	WHERE s.`type` = 'agent' AND COALESCE(s.`harness`, 'other') = COALESCE(u.`harness`, 'other')
	ORDER BY s.`createdAt`, s.`id`
	LIMIT 1
) AS `keep`
FROM `user` u
WHERE u.`type` = 'agent';
--> statement-breakpoint

-- Everything a bot can be referenced by. Auth tables are left alone: a bot has
-- no session, account or OAuth row to repoint.
UPDATE `comment` SET `authorId` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `authorId`)
WHERE `authorId` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint
UPDATE `feedback_comment` SET `authorId` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `authorId`)
WHERE `authorId` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint
UPDATE `issue` SET `creatorId` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `creatorId`)
WHERE `creatorId` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint
UPDATE `issue` SET `assigneeId` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `assigneeId`)
WHERE `assigneeId` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint
UPDATE `attachment` SET `uploadedBy` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `uploadedBy`)
WHERE `uploadedBy` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint
UPDATE `notification` SET `actorId` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `actorId`)
WHERE `actorId` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint
UPDATE `notification` SET `userId` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `userId`)
WHERE `userId` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint

-- Membership is (workspace, user) unique, so drop a duplicate's row where the
-- survivor already belongs, then hand over the rest.
DELETE FROM `workspace_member`
WHERE `userId` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`)
  AND EXISTS (
	SELECT 1 FROM `workspace_member` k
	WHERE k.`workspaceId` = `workspace_member`.`workspaceId`
	  AND k.`userId` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `workspace_member`.`userId`)
);
--> statement-breakpoint
UPDATE `workspace_member` SET `userId` = (SELECT `keep` FROM `agent_merge` WHERE `from` = `userId`)
WHERE `userId` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint

-- Rebuild the grants, taking the harness off the identity each one pointed at
-- while that table still exists.
CREATE TABLE `__new_agent_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`installedByUserId` text NOT NULL,
	`clientId` text NOT NULL,
	`harness` text NOT NULL,
	`scopes` text NOT NULL,
	`lastUsedAt` integer,
	`revokedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`installedByUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_grant` (`id`, `installedByUserId`, `clientId`, `harness`, `scopes`, `lastUsedAt`, `revokedAt`, `createdAt`)
SELECT g.`id`, g.`installedByUserId`, g.`clientId`, COALESCE(i.`harness`, 'other'),
       g.`scopes`, g.`lastUsedAt`, g.`revokedAt`, g.`createdAt`
FROM `agent_grant` g
JOIN `agent_identity` i ON i.`id` = g.`agentIdentityId`;
--> statement-breakpoint
DROP TABLE `agent_grant`;
--> statement-breakpoint
ALTER TABLE `__new_agent_grant` RENAME TO `agent_grant`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_grant_unique` ON `agent_grant` (`clientId`,`installedByUserId`);
--> statement-breakpoint
CREATE INDEX `agent_grant_installer` ON `agent_grant` (`installedByUserId`);
--> statement-breakpoint

DROP TABLE `agent_identity`;
--> statement-breakpoint

-- Safe only now that every reference has been handed over.
DELETE FROM `user` WHERE `id` IN (SELECT `from` FROM `agent_merge` WHERE `from` <> `keep`);
--> statement-breakpoint

-- A bot created before harnesses existed has none; it is the generic one.
UPDATE `user` SET `harness` = 'other' WHERE `type` = 'agent' AND `harness` IS NULL;
--> statement-breakpoint

-- The survivors are now the app-wide identity for their harness, so give them
-- the canonical name and address rather than a workspace-scoped one.
UPDATE `user` SET `email` = `harness` || '@agents.invalid' WHERE `type` = 'agent';
--> statement-breakpoint

DROP TABLE `agent_merge`;
--> statement-breakpoint

PRAGMA foreign_keys=ON;

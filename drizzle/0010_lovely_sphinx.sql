-- Re-keys an agent identity on (workspace, harness) instead of (client, workspace),
-- and moves the OAuth client onto the grant.
--
-- Hand-written rather than generated. SQLite cannot `ADD COLUMN ... NOT NULL`
-- to a table that already has rows, and the generated version also dropped
-- `agent_identity.clientId` before anything could copy it onto the grants that
-- now need it. Both tables are therefore rebuilt, in an order that reads the old
-- shape before replacing it.
--
-- Nothing is discarded except duplicates the new key cannot represent: two
-- clients of the same harness in one workspace were two bots and are now one, so
-- the earliest survives and the later one's grants are repointed at it. Bot
-- `user` rows are never touched — their names sit on comments and issues that
-- must keep rendering.
--
-- table-rebuild: create, copy, drop, rename, recreate indexes.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

CREATE TABLE `__new_agent_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`agentIdentityId` text NOT NULL,
	`installedByUserId` text NOT NULL,
	`clientId` text NOT NULL,
	`scopes` text NOT NULL,
	`lastUsedAt` integer,
	`revokedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`agentIdentityId`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installedByUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- `surviving` is the identity each old one collapses into: the earliest row for
-- its (workspace, harness), which is the one the new unique index will allow.
INSERT INTO `__new_agent_grant` (`id`, `agentIdentityId`, `installedByUserId`, `clientId`, `scopes`, `lastUsedAt`, `revokedAt`, `createdAt`)
SELECT g.`id`, surviving.`keep`, g.`installedByUserId`, i.`clientId`, g.`scopes`, g.`lastUsedAt`, g.`revokedAt`, g.`createdAt`
FROM `agent_grant` g
JOIN `agent_identity` i ON i.`id` = g.`agentIdentityId`
JOIN `user` u ON u.`id` = i.`userId`
JOIN (
	SELECT i2.`id` AS `from`, (
		SELECT i3.`id` FROM `agent_identity` i3
		JOIN `user` u3 ON u3.`id` = i3.`userId`
		WHERE i3.`workspaceId` = i2.`workspaceId`
		  AND COALESCE(u3.`harness`, 'other') = COALESCE(u2.`harness`, 'other')
		ORDER BY i3.`createdAt`, i3.`id`
		LIMIT 1
	) AS `keep`
	FROM `agent_identity` i2
	JOIN `user` u2 ON u2.`id` = i2.`userId`
) surviving ON surviving.`from` = i.`id`
WHERE g.`id` = (
	-- One grant per (client, person) now, so collapse any duplicates the old key
	-- allowed, keeping the earliest.
	SELECT g2.`id` FROM `agent_grant` g2
	JOIN `agent_identity` i2 ON i2.`id` = g2.`agentIdentityId`
	WHERE i2.`clientId` = i.`clientId` AND g2.`installedByUserId` = g.`installedByUserId`
	ORDER BY g2.`createdAt`, g2.`id`
	LIMIT 1
);
--> statement-breakpoint
DROP TABLE `agent_grant`;
--> statement-breakpoint
ALTER TABLE `__new_agent_grant` RENAME TO `agent_grant`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_grant_unique` ON `agent_grant` (`clientId`,`installedByUserId`);
--> statement-breakpoint
CREATE INDEX `agent_grant_installer` ON `agent_grant` (`installedByUserId`);
--> statement-breakpoint
CREATE INDEX `agent_grant_identity` ON `agent_grant` (`agentIdentityId`);
--> statement-breakpoint
CREATE TABLE `__new_agent_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`workspaceId` text NOT NULL,
	`harness` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Only the surviving identity per (workspace, harness); the grants above already
-- point at it. `user.harness` is where the harness has lived since 0009.
INSERT INTO `__new_agent_identity` (`id`, `userId`, `workspaceId`, `harness`, `createdAt`)
SELECT i.`id`, i.`userId`, i.`workspaceId`, COALESCE(u.`harness`, 'other'), i.`createdAt`
FROM `agent_identity` i
JOIN `user` u ON u.`id` = i.`userId`
WHERE i.`id` = (
	SELECT i3.`id` FROM `agent_identity` i3
	JOIN `user` u3 ON u3.`id` = i3.`userId`
	WHERE i3.`workspaceId` = i.`workspaceId`
	  AND COALESCE(u3.`harness`, 'other') = COALESCE(u.`harness`, 'other')
	ORDER BY i3.`createdAt`, i3.`id`
	LIMIT 1
);
--> statement-breakpoint
DROP TABLE `agent_identity`;
--> statement-breakpoint
ALTER TABLE `__new_agent_identity` RENAME TO `agent_identity`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_identity_unique` ON `agent_identity` (`workspaceId`,`harness`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_identity_userId_unique` ON `agent_identity` (`userId`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;

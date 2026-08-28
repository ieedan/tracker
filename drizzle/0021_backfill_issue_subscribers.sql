-- Custom SQL migration file, put your code below! --

-- Who hears about an issue used to be worked out at notify time, from the
-- assignee and the creator columns. It is now `issue_subscriber`, which only
-- started being written when that table landed one migration ago — so every
-- issue filed before then follows nobody, and nothing that happens on it would
-- reach an inbox.
--
-- Seed the two rows that the old inline audience implied. `OR IGNORE` leans on
-- the unique index over (issueId, userId), so an issue already touched since
-- the table landed keeps the rows it has, and re-running is free.
INSERT OR IGNORE INTO `issue_subscriber` (`id`, `issueId`, `userId`, `createdAt`)
SELECT lower(hex(randomblob(16))), `id`, `creatorId`, `createdAt` FROM `issue`;
--> statement-breakpoint
INSERT OR IGNORE INTO `issue_subscriber` (`id`, `issueId`, `userId`, `createdAt`)
SELECT lower(hex(randomblob(16))), `id`, `assigneeId`, `createdAt`
FROM `issue`
WHERE `assigneeId` IS NOT NULL AND `assigneeId` != '';

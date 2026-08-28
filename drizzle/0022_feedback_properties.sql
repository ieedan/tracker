-- Feedback gains the two properties that made it read as a lesser kind of
-- issue: a priority, and an assignee (ENG-77).
--
-- `ON DELETE set null` is written by hand. `drizzle-kit generate` drops the
-- referential action when a column is added — the same defect migration 0007
-- had to rebuild `issue` over — and an omitted action means NO ACTION in
-- SQLite, so removing a member who had triaged anything would fail with
-- FOREIGN KEY constraint failed. Stating it here is legal on an added column
-- because the column defaults to NULL.
ALTER TABLE `feedback` ADD `priority` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `assigneeId` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `feedback_assignee` ON `feedback` (`assigneeId`);

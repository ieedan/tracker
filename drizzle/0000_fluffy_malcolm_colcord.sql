CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'open' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);

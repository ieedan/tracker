CREATE TABLE `webhook` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`events` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_workspace` ON `webhook` (`workspaceId`);--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`webhookId` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`responseStatus` integer,
	`error` text,
	`nextAttemptAt` integer,
	`deliveredAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`webhookId`) REFERENCES `webhook`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `delivery_webhook` ON `webhook_delivery` (`webhookId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `delivery_due` ON `webhook_delivery` (`status`,`nextAttemptAt`);
CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lead_days` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`birth_month` integer NOT NULL,
	`birth_day` integer NOT NULL,
	`birth_year` integer,
	`notes` text,
	`lead_days` integer,
	`muted` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `person_birthday_idx` ON `person` (`birth_month`,`birth_day`);--> statement-breakpoint
CREATE INDEX `person_external_idx` ON `person` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `person_group` (
	`person_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`person_id`, `group_id`),
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `person_group_group_idx` ON `person_group` (`group_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`default_lead_days` integer DEFAULT 0 NOT NULL,
	`notify_hour` integer DEFAULT 9 NOT NULL,
	`notify_minute` integer DEFAULT 0 NOT NULL,
	`leap_day_policy` text DEFAULT 'feb28' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skipped` (
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`source`, `external_id`)
);

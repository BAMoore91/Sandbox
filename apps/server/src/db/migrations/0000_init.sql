CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE `cameras` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rtsp_url` text NOT NULL,
	`sub_rtsp_url` text,
	`onvif_url` text,
	`username` text,
	`password_enc` text,
	`enabled` integer DEFAULT true NOT NULL,
	`ai_enabled` integer DEFAULT false NOT NULL,
	`ai_config` text,
	`retention_days` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cameras_enabled_idx` ON `cameras` (`enabled`);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`camera_id` text NOT NULL,
	`file_path` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`codec` text NOT NULL,
	`width` integer,
	`height` integer,
	FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recordings_cam_start_idx` ON `recordings` (`camera_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `recordings_start_idx` ON `recordings` (`started_at`);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`camera_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text,
	`confidence` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`metadata` text,
	`thumbnail_path` text,
	FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_cam_type_start_idx` ON `events` (`camera_id`,`type`,`started_at`);
--> statement-breakpoint
CREATE INDEX `events_start_idx` ON `events` (`started_at`);

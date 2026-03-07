CREATE TABLE `push_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`digest_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_type` text NOT NULL,
	`status` text NOT NULL,
	`external_id` text,
	`error` text,
	`retryable` integer DEFAULT 0,
	`attempt` integer DEFAULT 1,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`digest_id`) REFERENCES `digests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_push_logs_user_id` ON `push_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_push_logs_digest_id` ON `push_logs` (`digest_id`);--> statement-breakpoint
CREATE INDEX `idx_push_logs_retry` ON `push_logs` (`status`,`retryable`);--> statement-breakpoint
ALTER TABLE `digests` ADD `push_attempts` integer DEFAULT 0;
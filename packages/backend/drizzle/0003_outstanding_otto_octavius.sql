PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_story_arcs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`tags` text DEFAULT '[]',
	`entities` text DEFAULT '[]',
	`keywords` text DEFAULT '[]',
	`status` text DEFAULT 'active' NOT NULL,
	`first_seen` integer NOT NULL,
	`last_updated` integer NOT NULL,
	`item_count` integer DEFAULT 0,
	`source_count` integer DEFAULT 0,
	`buzz_score` real DEFAULT 0,
	`summary_updated_at` integer,
	`title_source` text DEFAULT 'rule' NOT NULL,
	`merged_into_id` text,
	`timeline` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_story_arcs`("id", "user_id", "title", "summary", "tags", "entities", "keywords", "status", "first_seen", "last_updated", "item_count", "source_count", "buzz_score", "summary_updated_at", "title_source", "merged_into_id", "timeline", "created_at", "updated_at") SELECT "id", "user_id", "title", "summary", "tags", "entities", "keywords", "status", "first_seen", "last_updated", "item_count", "source_count", "buzz_score", "summary_updated_at", "title_source", "merged_into_id", "timeline", "created_at", "updated_at" FROM `story_arcs`;--> statement-breakpoint
DROP TABLE `story_arcs`;--> statement-breakpoint
ALTER TABLE `__new_story_arcs` RENAME TO `story_arcs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_story_arcs_user_status_last_updated` ON `story_arcs` (`user_id`,`status`,`last_updated`);--> statement-breakpoint
CREATE INDEX `idx_story_arcs_user_last_updated` ON `story_arcs` (`user_id`,`last_updated`);--> statement-breakpoint
CREATE INDEX `idx_story_arcs_status_last_updated` ON `story_arcs` (`status`,`last_updated`);--> statement-breakpoint
CREATE INDEX `idx_story_arcs_merged_into` ON `story_arcs` (`merged_into_id`);
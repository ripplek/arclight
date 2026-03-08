CREATE TABLE `buzz_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`arc_id` text,
	`item_id` text NOT NULL,
	`source_id` text,
	`entity` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`velocity` real DEFAULT 0,
	`source_count` integer DEFAULT 0,
	`event_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`arc_id`) REFERENCES `story_arcs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `feed_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_buzz_events_user_event_at` ON `buzz_events` (`user_id`,`event_at`);--> statement-breakpoint
CREATE INDEX `idx_buzz_events_arc_event_at` ON `buzz_events` (`arc_id`,`event_at`);--> statement-breakpoint
CREATE INDEX `idx_buzz_events_entity_event_at` ON `buzz_events` (`entity`,`event_at`);--> statement-breakpoint
ALTER TABLE `arc_items` ADD `relevance_score` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `arc_items` ADD `is_key_event` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `arc_items` ADD `headline` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_arc_items_arc_item` ON `arc_items` (`arc_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_arc_items_arc_added_at` ON `arc_items` (`arc_id`,`added_at`);--> statement-breakpoint
CREATE INDEX `idx_arc_items_item_id` ON `arc_items` (`item_id`);--> statement-breakpoint
ALTER TABLE `arc_items` DROP COLUMN `position`;--> statement-breakpoint
ALTER TABLE `story_arcs` ADD `keywords` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `story_arcs` ADD `source_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `story_arcs` ADD `buzz_score` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `story_arcs` ADD `summary_updated_at` integer;--> statement-breakpoint
ALTER TABLE `story_arcs` ADD `title_source` text DEFAULT 'rule' NOT NULL;--> statement-breakpoint
ALTER TABLE `story_arcs` ADD `merged_into_id` text REFERENCES story_arcs(id);--> statement-breakpoint
ALTER TABLE `story_arcs` ADD `updated_at` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_story_arcs_user_status_last_updated` ON `story_arcs` (`user_id`,`status`,`last_updated`);--> statement-breakpoint
CREATE INDEX `idx_story_arcs_user_last_updated` ON `story_arcs` (`user_id`,`last_updated`);--> statement-breakpoint
CREATE INDEX `idx_story_arcs_status_last_updated` ON `story_arcs` (`status`,`last_updated`);--> statement-breakpoint
CREATE INDEX `idx_story_arcs_merged_into` ON `story_arcs` (`merged_into_id`);
CREATE TABLE `corpus_units` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_id` int NOT NULL,
	`section_id` int NOT NULL,
	`passage_id` int NOT NULL,
	`unit_number` int NOT NULL,
	`start_line` int NOT NULL,
	`end_line` int NOT NULL,
	`unit_text` text NOT NULL,
	`unit_kind` enum('assertion','story','question','strategy','risk','mixed') NOT NULL DEFAULT 'mixed',
	`topic_json` json NOT NULL,
	`annotation_status` enum('generated','reviewed','rejected') NOT NULL DEFAULT 'generated',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `corpus_units_id` PRIMARY KEY(`id`),
	CONSTRAINT `corpus_units_source_number_unique` UNIQUE(`source_id`,`unit_number`)
);
--> statement-breakpoint
ALTER TABLE `corpus_sections` ADD `review_status` enum('approved','needs_review','rejected') DEFAULT 'needs_review' NOT NULL;--> statement-breakpoint
CREATE INDEX `corpus_units_source_range_idx` ON `corpus_units` (`source_id`,`start_line`,`end_line`);--> statement-breakpoint
CREATE INDEX `corpus_units_passage_idx` ON `corpus_units` (`passage_id`);
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversation_id` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`risk_level` enum('normal','elevated','high') NOT NULL DEFAULT 'normal',
	`citations_json` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`title` varchar(255) NOT NULL,
	`scenario` enum('relationship','communication','decision','general') NOT NULL DEFAULT 'general',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `corpus_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_id` int NOT NULL,
	`line_number` int NOT NULL,
	`line_text` text NOT NULL,
	`line_hash` varchar(64) NOT NULL,
	`is_blank` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `corpus_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `corpus_lines_source_line_unique` UNIQUE(`source_id`,`line_number`)
);
--> statement-breakpoint
CREATE TABLE `corpus_passages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_id` int NOT NULL,
	`section_id` int NOT NULL,
	`passage_number` int NOT NULL,
	`start_line` int NOT NULL,
	`end_line` int NOT NULL,
	`line_count` int NOT NULL,
	`passage_text` text NOT NULL,
	`segmentation_method` varchar(80) NOT NULL,
	`annotation_json` json,
	`annotation_status` enum('generated','reviewed','rejected') NOT NULL DEFAULT 'generated',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `corpus_passages_id` PRIMARY KEY(`id`),
	CONSTRAINT `corpus_passages_source_number_unique` UNIQUE(`source_id`,`passage_number`)
);
--> statement-breakpoint
CREATE TABLE `corpus_sections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_id` int NOT NULL,
	`parent_section_id` int,
	`title` text NOT NULL,
	`section_kind` enum('source_root','detected_chapter','detected_section') NOT NULL,
	`start_line` int NOT NULL,
	`end_line` int NOT NULL,
	`detection_method` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `corpus_sections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `corpus_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_key` varchar(80) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`original_sha256` varchar(64) NOT NULL,
	`original_byte_count` int NOT NULL,
	`expected_logical_line_count` int NOT NULL,
	`processed_line_count` int NOT NULL DEFAULT 0,
	`blank_line_count` int NOT NULL DEFAULT 0,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`processing_note` text,
	`processed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `corpus_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `corpus_sources_source_key_unique` UNIQUE(`source_key`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` enum('expression','rhythm','judgment','questioning','case','boundary','safety') NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text NOT NULL,
	`evidence_json` json NOT NULL,
	`occurrence_count` int NOT NULL DEFAULT 1,
	`review_status` enum('pending','approved','needs_revision','rejected') NOT NULL DEFAULT 'pending',
	`reviewer_note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` enum('expression','framework','followup','case','boundary','safety') NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`evidence_json` json NOT NULL,
	`status` enum('pending','approved','needs_revision','rejected') NOT NULL DEFAULT 'pending',
	`reviewer_note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `review_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation_order_idx` ON `chat_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `conversations_user_updated_idx` ON `conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `corpus_lines_source_order_idx` ON `corpus_lines` (`source_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `corpus_passages_source_range_idx` ON `corpus_passages` (`source_id`,`start_line`,`end_line`);--> statement-breakpoint
CREATE INDEX `corpus_passages_section_idx` ON `corpus_passages` (`section_id`);--> statement-breakpoint
CREATE INDEX `corpus_sections_source_range_idx` ON `corpus_sections` (`source_id`,`start_line`,`end_line`);--> statement-breakpoint
CREATE INDEX `knowledge_entries_category_review_idx` ON `knowledge_entries` (`category`,`review_status`);
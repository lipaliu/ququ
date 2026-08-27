CREATE TABLE `corpus_version_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`version_id` int NOT NULL,
	`source_id` int NOT NULL,
	`source_alias` varchar(120) NOT NULL,
	`source_file_name` varchar(255) NOT NULL,
	`source_sha256` varchar(64) NOT NULL,
	`source_order` int NOT NULL,
	`mapping_method` enum('ingested','verified_reuse') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `corpus_version_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `corpus_version_source_alias_unique` UNIQUE(`version_id`,`source_alias`)
);
--> statement-breakpoint
CREATE TABLE `corpus_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`version_key` varchar(80) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`is_default_learning_version` boolean NOT NULL DEFAULT false,
	`processing_status` enum('draft','ready','active','archived') NOT NULL DEFAULT 'draft',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `corpus_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `corpus_versions_version_key_unique` UNIQUE(`version_key`)
);
--> statement-breakpoint
CREATE INDEX `corpus_version_sources_order_idx` ON `corpus_version_sources` (`version_id`,`source_order`);
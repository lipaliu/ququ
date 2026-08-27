ALTER TABLE `corpus_units` ADD `expression_hits_json` json NOT NULL;--> statement-breakpoint
ALTER TABLE `corpus_units` ADD `case_type` enum('none','relationship','communication','decision','financial','other') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `corpus_units` ADD `boundary_tags_json` json NOT NULL;
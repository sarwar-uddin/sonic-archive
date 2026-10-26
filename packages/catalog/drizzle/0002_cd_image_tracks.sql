-- M7: a single-file CD image becomes one track per CUE sheet entry.
-- Additive: three new columns, and the one-track-per-file unique index is
-- replaced by one on (file_id, segment). Existing rows become segment 0
-- (whole file) and keep their ids. No rows are changed or removed.
DROP INDEX `tracks_file_id_unique`;--> statement-breakpoint
ALTER TABLE `tracks` ADD `segment` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tracks` ADD `start_ms` integer;--> statement-breakpoint
ALTER TABLE `tracks` ADD `end_ms` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_file_segment_unique` ON `tracks` (`file_id`,`segment`);
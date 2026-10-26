-- M15: dynamic range per track. A new table only.
CREATE TABLE `track_dynamics` (
	`track_id` integer PRIMARY KEY NOT NULL,
	`dr_exact` real,
	`peak_db` real,
	`source_size` integer NOT NULL,
	`source_mtime_ms` integer NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);

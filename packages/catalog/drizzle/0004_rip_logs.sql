-- M9: rip logs per album (EAC/XLD/CUETools). A new table only.
CREATE TABLE `rip_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` integer NOT NULL,
	`rel_path` text NOT NULL,
	`source_size` integer NOT NULL,
	`source_mtime_ms` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rip_logs_album_path_unique` ON `rip_logs` (`album_id`,`rel_path`);
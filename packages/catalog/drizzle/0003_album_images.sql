-- M8: scanned artwork per album, for the scan viewer. A new table only.
CREATE TABLE `album_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` integer NOT NULL,
	`artwork_id` integer NOT NULL,
	`rel_path` text NOT NULL,
	`source_size` integer NOT NULL,
	`source_mtime_ms` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artwork_id`) REFERENCES `artwork`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `album_images_album_path_unique` ON `album_images` (`album_id`,`rel_path`);--> statement-breakpoint
CREATE INDEX `album_images_artwork_idx` ON `album_images` (`artwork_id`);
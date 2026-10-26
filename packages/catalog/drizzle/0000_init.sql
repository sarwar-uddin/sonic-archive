CREATE TABLE `albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_key` text NOT NULL,
	`title` text NOT NULL,
	`album_artist_id` integer,
	`year` integer,
	`musicbrainz_album_id` text,
	`artwork_id` integer,
	`total_discs` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`album_artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artwork_id`) REFERENCES `artwork`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `albums_group_key_unique` ON `albums` (`group_key`);--> statement-breakpoint
CREATE INDEX `albums_album_artist_idx` ON `albums` (`album_artist_id`);--> statement-breakpoint
CREATE TABLE `artists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_name` text,
	`name_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artists_name_key_unique` ON `artists` (`name_key`);--> statement-breakpoint
CREATE TABLE `artwork` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sha256` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	`byte_size` integer NOT NULL,
	`source` text NOT NULL,
	`cache_file` text NOT NULL,
	CONSTRAINT "artwork_source_check" CHECK("artwork"."source" in ('embedded', 'folder'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_sha256_unique` ON `artwork` (`sha256`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`root_id` integer NOT NULL,
	`rel_path` text NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`audio_md5` text,
	`status` text NOT NULL,
	`error_message` text,
	`first_seen_scan_id` integer NOT NULL,
	`last_seen_scan_id` integer NOT NULL,
	`missing_since` integer,
	FOREIGN KEY (`root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_seen_scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_seen_scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "files_status_check" CHECK("files"."status" in ('present', 'missing', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_root_path_unique` ON `files` (`root_id`,`rel_path`);--> statement-breakpoint
CREATE INDEX `files_status_idx` ON `files` (`status`);--> statement-breakpoint
CREATE INDEX `files_audio_md5_idx` ON `files` (`audio_md5`);--> statement-breakpoint
CREATE TABLE `genres` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genres_name_key_unique` ON `genres` (`name_key`);--> statement-breakpoint
CREATE TABLE `library_roots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_roots_path_unique` ON `library_roots` (`path`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`root_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`scope_subpath` text,
	`seen` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`unchanged` integer DEFAULT 0 NOT NULL,
	`missing` integer DEFAULT 0 NOT NULL,
	`restored` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	FOREIGN KEY (`root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scans_status_check" CHECK("scans"."status" in ('running', 'completed', 'aborted', 'failed')),
	CONSTRAINT "scans_mode_check" CHECK("scans"."mode" in ('incremental', 'full'))
);
--> statement-breakpoint
CREATE TABLE `track_artists` (
	`track_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`track_id`, `role`, `position`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "track_artists_role_check" CHECK("track_artists"."role" in ('artist', 'composer'))
);
--> statement-breakpoint
CREATE INDEX `track_artists_artist_idx` ON `track_artists` (`artist_id`);--> statement-breakpoint
CREATE TABLE `track_genres` (
	`track_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	PRIMARY KEY(`track_id`, `genre_id`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `track_genres_genre_idx` ON `track_genres` (`genre_id`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`album_id` integer,
	`title` text,
	`display_artist` text,
	`track_no` integer,
	`track_total` integer,
	`disc_no` integer,
	`disc_total` integer,
	`year` integer,
	`duration_ms` integer,
	`codec` text,
	`container` text,
	`lossless` integer,
	`sample_rate` integer,
	`bit_depth` integer,
	`channels` integer,
	`bitrate` integer,
	`has_embedded_art` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_file_id_unique` ON `tracks` (`file_id`);--> statement-breakpoint
CREATE INDEX `tracks_album_idx` ON `tracks` (`album_id`);
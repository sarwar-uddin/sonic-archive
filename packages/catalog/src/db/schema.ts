/**
 * Catalog schema.
 *
 * Every table here is *derived* from the music library and can be rebuilt by
 * rescanning. User-authored data (ratings, notes, playlists) will live in
 * separate tables that the scanner never writes (milestone M7).
 *
 * Changing this file? Run `pnpm --filter @sonic-archive/catalog db:generate`
 * and review the generated SQL before committing (see docs/safety.md, #9).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);

/** Configured library roots. One row today; the shape allows several later. */
export const libraryRoots = sqliteTable('library_roots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull().unique(),
  createdAt: createdAt(),
});

export const SCAN_STATUSES = ['running', 'completed', 'aborted', 'failed'] as const;
export const SCAN_MODES = ['incremental', 'full'] as const;

/** One row per scan run: an audit trail of what each scan saw and changed. */
export const scans = sqliteTable(
  'scans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rootId: integer('root_id')
      .notNull()
      .references(() => libraryRoots.id),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    status: text('status', { enum: SCAN_STATUSES }).notNull(),
    mode: text('mode', { enum: SCAN_MODES }).notNull(),
    /** Relative folder a sample scan was limited to; null for a full-scope scan. */
    scopeSubpath: text('scope_subpath'),
    seen: integer('seen').notNull().default(0),
    added: integer('added').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    unchanged: integer('unchanged').notNull().default(0),
    missing: integer('missing').notNull().default(0),
    restored: integer('restored').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    errorMessage: text('error_message'),
  },
  (t) => [
    check('scans_status_check', sql`${t.status} in ('running', 'completed', 'aborted', 'failed')`),
    check('scans_mode_check', sql`${t.mode} in ('incremental', 'full')`),
  ],
);

export const FILE_STATUSES = ['present', 'missing', 'error'] as const;

/**
 * Every audio file ever seen under a root. Rows are never deleted: a file
 * that disappears is marked `missing` (docs/safety.md, #10).
 */
export const files = sqliteTable(
  'files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rootId: integer('root_id')
      .notNull()
      .references(() => libraryRoots.id),
    /** Path relative to the root, exactly as the filesystem reported it. */
    relPath: text('rel_path').notNull(),
    size: integer('size').notNull(),
    /** Whole milliseconds; together with `size` this drives incremental scans. */
    mtimeMs: integer('mtime_ms').notNull(),
    /** Hex MD5 of the decoded audio, when the format stores one (FLAC). */
    audioMd5: text('audio_md5'),
    status: text('status', { enum: FILE_STATUSES }).notNull(),
    errorMessage: text('error_message'),
    firstSeenScanId: integer('first_seen_scan_id')
      .notNull()
      .references(() => scans.id),
    lastSeenScanId: integer('last_seen_scan_id')
      .notNull()
      .references(() => scans.id),
    missingSince: integer('missing_since', { mode: 'timestamp_ms' }),
  },
  (t) => [
    // The idempotency key: rescanning the same file updates this row.
    uniqueIndex('files_root_path_unique').on(t.rootId, t.relPath),
    index('files_status_idx').on(t.status),
    index('files_audio_md5_idx').on(t.audioMd5),
    check('files_status_check', sql`${t.status} in ('present', 'missing', 'error')`),
  ],
);

export const artists = sqliteTable('artists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sortName: text('sort_name'),
  /** `nameKey(name)`: case-, accent- and whitespace-insensitive identity. */
  nameKey: text('name_key').notNull().unique(),
});

export const ARTWORK_SOURCES = ['embedded', 'folder'] as const;

/** Cover images, deduplicated by content hash and stored in the cache dir. */
export const artwork = sqliteTable(
  'artwork',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sha256: text('sha256').notNull().unique(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    byteSize: integer('byte_size').notNull(),
    source: text('source', { enum: ARTWORK_SOURCES }).notNull(),
    /** File name inside the artwork cache dir (never a library path). */
    cacheFile: text('cache_file').notNull(),
  },
  (t) => [check('artwork_source_check', sql`${t.source} in ('embedded', 'folder')`)],
);

export const albums = sqliteTable(
  'albums',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `mbid:<id>` or `tag:<albumartist key>|<album key>`; see the scanner. */
    groupKey: text('group_key').notNull().unique(),
    title: text('title').notNull(),
    albumArtistId: integer('album_artist_id').references(() => artists.id),
    year: integer('year'),
    musicbrainzAlbumId: text('musicbrainz_album_id'),
    artworkId: integer('artwork_id').references(() => artwork.id, { onDelete: 'set null' }),
    totalDiscs: integer('total_discs'),
    createdAt: createdAt(),
  },
  (t) => [index('albums_album_artist_idx').on(t.albumArtistId)],
);

/**
 * Parsed metadata for one track. Usually one track per file; a single-file
 * CD image with a CUE sheet holds one track per sheet entry (`segment`).
 */
export const tracks = sqliteTable(
  'tracks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id),
    /** 0 for a whole file; the CUE track number for a track cut from an image. */
    segment: integer('segment').notNull().default(0),
    /** Where the track starts and ends inside its file; null for a whole file. */
    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
    albumId: integer('album_id').references(() => albums.id),
    title: text('title'),
    /** The artist string exactly as tagged, e.g. "A feat. B". */
    displayArtist: text('display_artist'),
    trackNo: integer('track_no'),
    trackTotal: integer('track_total'),
    discNo: integer('disc_no'),
    discTotal: integer('disc_total'),
    year: integer('year'),
    durationMs: integer('duration_ms'),
    codec: text('codec'),
    container: text('container'),
    lossless: integer('lossless', { mode: 'boolean' }),
    sampleRate: integer('sample_rate'),
    /** Null for formats without a fixed bit depth (MP3, Opus, …). */
    bitDepth: integer('bit_depth'),
    channels: integer('channels'),
    bitrate: integer('bitrate'),
    hasEmbeddedArt: integer('has_embedded_art', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    // The idempotency key: rescanning a file updates its track(s) in place.
    uniqueIndex('tracks_file_segment_unique').on(t.fileId, t.segment),
    index('tracks_album_idx').on(t.albumId),
  ],
);

export const CREDIT_ROLES = ['artist', 'composer'] as const;

export const trackArtists = sqliteTable(
  'track_artists',
  {
    trackId: integer('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    artistId: integer('artist_id')
      .notNull()
      .references(() => artists.id),
    role: text('role', { enum: CREDIT_ROLES }).notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.trackId, t.role, t.position] }),
    index('track_artists_artist_idx').on(t.artistId),
    check('track_artists_role_check', sql`${t.role} in ('artist', 'composer')`),
  ],
);

export const genres = sqliteTable('genres', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().unique(),
});

export const trackGenres = sqliteTable(
  'track_genres',
  {
    trackId: integer('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    genreId: integer('genre_id')
      .notNull()
      .references(() => genres.id),
  },
  (t) => [
    primaryKey({ columns: [t.trackId, t.genreId] }),
    index('track_genres_genre_idx').on(t.genreId),
  ],
);

/**
 * Scanned artwork found in an album's folder (booklet pages, back, disc…),
 * for the album's scan viewer. Each row points at a viewing copy in the
 * artwork cache; the source image in the library is only ever read. The
 * kind of each scan is derived from its name when read (src/metadata/scans.ts).
 */
export const albumImages = sqliteTable(
  'album_images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    albumId: integer('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    artworkId: integer('artwork_id')
      .notNull()
      .references(() => artwork.id),
    /** Source image, relative to the library root. Informational only. */
    relPath: text('rel_path').notNull(),
    /** Size and mtime of the source when its copy was made; a change re-renders it. */
    sourceSize: integer('source_size').notNull(),
    sourceMtimeMs: integer('source_mtime_ms').notNull(),
  },
  (t) => [
    uniqueIndex('album_images_album_path_unique').on(t.albumId, t.relPath),
    index('album_images_artwork_idx').on(t.artworkId),
  ],
);

/**
 * Rip logs found in an album's folder (EAC/XLD .log, CUETools .accurip),
 * decoded to text. They are parsed when read (src/metadata/rip-log.ts), so
 * better parsing rules apply without rescanning, and the full log can be shown.
 */
export const ripLogs = sqliteTable(
  'rip_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    albumId: integer('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    /** Source file, relative to the library root. Informational only. */
    relPath: text('rel_path').notNull(),
    sourceSize: integer('source_size').notNull(),
    sourceMtimeMs: integer('source_mtime_ms').notNull(),
    text: text('text').notNull(),
  },
  (t) => [uniqueIndex('rip_logs_album_path_unique').on(t.albumId, t.relPath)],
);

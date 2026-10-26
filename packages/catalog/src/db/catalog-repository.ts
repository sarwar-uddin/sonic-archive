import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { nameKey } from '../text/normalize.ts';
import type { CatalogExecutor } from './database.ts';
import {
  albumImages,
  albums,
  artists,
  artwork,
  type CREDIT_ROLES,
  genres,
  trackArtists,
  trackGenres,
  tracks,
} from './schema.ts';

export type NewArtwork = Omit<typeof artwork.$inferInsert, 'id'>;
export type TrackRow = typeof tracks.$inferSelect;

/*
 * Upserts here look the row up by its natural key and then UPDATE or INSERT,
 * instead of using INSERT … ON CONFLICT DO UPDATE. SQLite's AUTOINCREMENT
 * consumes an id on every conflicting insert attempt, even one that ends in
 * an update, so rescanning 50k tracks would leave enormous id gaps.
 * better-sqlite3 is synchronous, so nothing can interleave between the
 * lookup and the write.
 */

/**
 * Returns the id of the artist matching `name` by `nameKey`, creating it if
 * needed. The first spelling seen becomes the display name, so "Björk" is not
 * overwritten by a later "BJORK".
 */
export function upsertArtist(
  db: CatalogExecutor,
  name: string,
  sortName: string | null = null,
): number {
  const key = requireKey(name, 'Artist');
  const existing = db
    .select({ id: artists.id, sortName: artists.sortName })
    .from(artists)
    .where(eq(artists.nameKey, key))
    .get();
  if (existing) {
    // Fill a missing sort name; leave everything else as first recorded.
    if (existing.sortName === null && sortName !== null) {
      db.update(artists).set({ sortName }).where(eq(artists.id, existing.id)).run();
    }
    return existing.id;
  }
  return db
    .insert(artists)
    .values({ name: name.trim(), sortName, nameKey: key })
    .returning({ id: artists.id })
    .get().id;
}

export function upsertGenre(db: CatalogExecutor, name: string): number {
  const key = requireKey(name, 'Genre');
  const existing = db.select({ id: genres.id }).from(genres).where(eq(genres.nameKey, key)).get();
  return (
    existing?.id ??
    db.insert(genres).values({ name: name.trim(), nameKey: key }).returning({ id: genres.id }).get()
      .id
  );
}

/** Artwork is content-addressed: identical images share one row. */
export function upsertArtwork(db: CatalogExecutor, input: NewArtwork): number {
  const existing = db
    .select({ id: artwork.id })
    .from(artwork)
    .where(eq(artwork.sha256, input.sha256))
    .get();
  return existing?.id ?? db.insert(artwork).values(input).returning({ id: artwork.id }).get().id;
}

export interface AlbumUpsertInput {
  readonly groupKey: string;
  readonly title: string;
  readonly albumArtistId: number | null;
  readonly year: number | null;
  readonly musicbrainzAlbumId: string | null;
  readonly totalDiscs: number | null;
  readonly artworkId: number | null;
}

/**
 * Upserts an album by its group key. Every track of an album calls this, so
 * a track with *missing* data must not erase what another track supplied:
 * nullable fields are only filled in, never cleared.
 */
export function upsertAlbum(db: CatalogExecutor, input: AlbumUpsertInput): number {
  const existing = db.select().from(albums).where(eq(albums.groupKey, input.groupKey)).get();
  if (!existing) return db.insert(albums).values(input).returning({ id: albums.id }).get().id;

  const discs = Math.max(input.totalDiscs ?? 0, existing.totalDiscs ?? 0);
  db.update(albums)
    .set({
      title: input.title,
      albumArtistId: input.albumArtistId ?? existing.albumArtistId,
      year: input.year ?? existing.year,
      musicbrainzAlbumId: input.musicbrainzAlbumId ?? existing.musicbrainzAlbumId,
      artworkId: input.artworkId ?? existing.artworkId,
      totalDiscs: discs === 0 ? null : discs,
    })
    .where(eq(albums.id, existing.id))
    .run();
  return existing.id;
}

/** The album a file's track(s) belong to, with its current artwork. */
export function getAlbumOfFile(
  db: CatalogExecutor,
  fileId: number,
): { albumId: number; artworkId: number | null } | undefined {
  return db
    .select({ albumId: albums.id, artworkId: albums.artworkId })
    .from(tracks)
    .innerJoin(albums, eq(albums.id, tracks.albumId))
    .where(eq(tracks.fileId, fileId))
    .orderBy(asc(tracks.segment))
    .get();
}

export function setAlbumArtwork(db: CatalogExecutor, albumId: number, artworkId: number): void {
  db.update(albums).set({ artworkId }).where(eq(albums.id, albumId)).run();
}

export interface Credit {
  readonly artistId: number;
  readonly role: (typeof CREDIT_ROLES)[number];
}

/**
 * Every column is required (null when unknown): a rescan reflects the file as
 * it is now, so a tag removed from the file must clear its column too.
 */
export type TrackValues = {
  [K in keyof Omit<typeof tracks.$inferInsert, 'id'>]-?: Exclude<
    (typeof tracks.$inferInsert)[K],
    undefined
  >;
};

export interface TrackUpsertInput extends TrackValues {
  /** In tag order; position is assigned per role. */
  readonly credits: readonly Credit[];
  readonly genreIds: readonly number[];
}

/**
 * Upserts one track of a file (by file and segment) and replaces its artist
 * and genre links. Runs in its own transaction (a savepoint if already inside
 * one), so a track is never left with half its credits.
 */
export function upsertTrack(db: CatalogExecutor, input: TrackUpsertInput): number {
  const { credits, genreIds, ...values } = input;
  const { fileId: _, segment: __, ...updatable } = values;

  return db.transaction((tx) => {
    const existing = tx
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.fileId, values.fileId), eq(tracks.segment, values.segment)))
      .get();
    let trackId: number;
    if (existing) {
      tx.update(tracks).set(updatable).where(eq(tracks.id, existing.id)).run();
      trackId = existing.id;
    } else {
      trackId = tx.insert(tracks).values(values).returning({ id: tracks.id }).get().id;
    }

    tx.delete(trackArtists).where(eq(trackArtists.trackId, trackId)).run();
    const rows = positionCredits(credits).map((c) => ({ ...c, trackId }));
    if (rows.length > 0) tx.insert(trackArtists).values(rows).run();

    tx.delete(trackGenres).where(eq(trackGenres.trackId, trackId)).run();
    const genreRows = [...new Set(genreIds)].map((genreId) => ({ trackId, genreId }));
    if (genreRows.length > 0) tx.insert(trackGenres).values(genreRows).run();

    return trackId;
  });
}

/**
 * Removes a file's tracks other than `keepSegments`, with their links: after
 * an image gains a CUE sheet its whole-file track goes, and the reverse.
 * Tracks are derived from the file, so they are rebuilt, not lost.
 */
export function removeOtherSegments(
  db: CatalogExecutor,
  fileId: number,
  keepSegments: readonly number[],
): void {
  const stale = db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(eq(tracks.fileId, fileId), notInArray(tracks.segment, [...keepSegments])))
    .all()
    .map((t) => t.id);
  if (stale.length === 0) return;
  db.delete(trackArtists).where(inArray(trackArtists.trackId, stale)).run();
  db.delete(trackGenres).where(inArray(trackGenres.trackId, stale)).run();
  db.delete(tracks).where(inArray(tracks.id, stale)).run();
}

/**
 * Deletes albums no track belongs to any more: left behind when retagging or
 * a change in grouping rules moves tracks to another album. Albums are
 * derived from tracks; tracks of missing files keep theirs. Returns the count.
 */
export function pruneEmptyAlbums(db: CatalogExecutor): number {
  return db
    .delete(albums)
    .where(
      sql`${albums.id} NOT IN (SELECT ${tracks.albumId} FROM ${tracks} WHERE ${tracks.albumId} IS NOT NULL)`,
    )
    .run().changes;
}

/** The first track of a file (its only one, unless it is a split CD image). */
export function getTrackByFileId(db: CatalogExecutor, fileId: number): TrackRow | undefined {
  return db
    .select()
    .from(tracks)
    .where(eq(tracks.fileId, fileId))
    .orderBy(asc(tracks.segment))
    .get();
}

function positionCredits(credits: readonly Credit[]) {
  const seen = new Set<string>();
  const nextPosition = new Map<string, number>();
  const rows: { artistId: number; role: Credit['role']; position: number }[] = [];
  for (const credit of credits) {
    const id = `${credit.role}:${credit.artistId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const position = nextPosition.get(credit.role) ?? 0;
    nextPosition.set(credit.role, position + 1);
    rows.push({ ...credit, position });
  }
  return rows;
}

function requireKey(name: string, label: string): string {
  const key = nameKey(name);
  if (key === '') throw new Error(`${label} name is empty.`);
  return key;
}

export type AlbumImageRow = Omit<typeof albumImages.$inferSelect, 'id' | 'albumId'>;

/** The scans recorded for an album, by source path. */
export function getAlbumImages(db: CatalogExecutor, albumId: number): AlbumImageRow[] {
  return db
    .select({
      relPath: albumImages.relPath,
      artworkId: albumImages.artworkId,
      sourceSize: albumImages.sourceSize,
      sourceMtimeMs: albumImages.sourceMtimeMs,
    })
    .from(albumImages)
    .where(eq(albumImages.albumId, albumId))
    .all();
}

/**
 * Makes an album's scans exactly `images`: updates rows whose source path is
 * known, adds new ones, and drops rows for images no longer in the folder.
 * The cached copies stay (content-addressed; another album may share one).
 */
export function setAlbumImages(
  db: CatalogExecutor,
  albumId: number,
  images: readonly AlbumImageRow[],
): void {
  db.transaction((tx) => {
    const existing = new Map(
      tx
        .select({ id: albumImages.id, relPath: albumImages.relPath })
        .from(albumImages)
        .where(eq(albumImages.albumId, albumId))
        .all()
        .map((r) => [r.relPath, r.id]),
    );
    for (const image of images) {
      const id = existing.get(image.relPath);
      if (id === undefined)
        tx.insert(albumImages)
          .values({ ...image, albumId })
          .run();
      else tx.update(albumImages).set(image).where(eq(albumImages.id, id)).run();
      existing.delete(image.relPath);
    }
    const stale = [...existing.values()];
    if (stale.length > 0) tx.delete(albumImages).where(inArray(albumImages.id, stale)).run();
  });
}

/** The cache file behind an artwork row, if the row exists. */
export function getArtworkCacheFile(db: CatalogExecutor, artworkId: number): string | undefined {
  return db
    .select({ cacheFile: artwork.cacheFile })
    .from(artwork)
    .where(eq(artwork.id, artworkId))
    .get()?.cacheFile;
}

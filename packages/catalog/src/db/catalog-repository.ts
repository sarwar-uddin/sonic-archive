import { eq, sql } from 'drizzle-orm';
import { nameKey } from '../text/normalize.ts';
import type { CatalogExecutor } from './database.ts';
import {
  albums,
  artists,
  artwork,
  type CREDIT_ROLES,
  genres,
  trackArtists,
  trackGenres,
  tracks,
} from './schema.ts';
import { excluded } from './sql-helpers.ts';

export type NewArtwork = Omit<typeof artwork.$inferInsert, 'id'>;
export type TrackRow = typeof tracks.$inferSelect;

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
  return db
    .insert(artists)
    .values({ name: name.trim(), sortName, nameKey: key })
    .onConflictDoUpdate({
      target: artists.nameKey,
      // Fill a missing sort name; leave everything else as first recorded.
      set: { sortName: sql`coalesce(${artists.sortName}, ${excluded(artists.sortName)})` },
    })
    .returning({ id: artists.id })
    .get().id;
}

export function upsertGenre(db: CatalogExecutor, name: string): number {
  const key = requireKey(name, 'Genre');
  return db
    .insert(genres)
    .values({ name: name.trim(), nameKey: key })
    .onConflictDoUpdate({ target: genres.nameKey, set: { nameKey: excluded(genres.nameKey) } })
    .returning({ id: genres.id })
    .get().id;
}

/** Artwork is content-addressed: identical images share one row. */
export function upsertArtwork(db: CatalogExecutor, input: NewArtwork): number {
  return db
    .insert(artwork)
    .values(input)
    .onConflictDoUpdate({ target: artwork.sha256, set: { sha256: excluded(artwork.sha256) } })
    .returning({ id: artwork.id })
    .get().id;
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
  return db
    .insert(albums)
    .values(input)
    .onConflictDoUpdate({
      target: albums.groupKey,
      set: {
        title: excluded(albums.title),
        albumArtistId: sql`coalesce(${excluded(albums.albumArtistId)}, ${albums.albumArtistId})`,
        year: sql`coalesce(${excluded(albums.year)}, ${albums.year})`,
        musicbrainzAlbumId: sql`coalesce(${excluded(albums.musicbrainzAlbumId)}, ${albums.musicbrainzAlbumId})`,
        artworkId: sql`coalesce(${excluded(albums.artworkId)}, ${albums.artworkId})`,
        totalDiscs: sql`nullif(max(coalesce(${excluded(albums.totalDiscs)}, 0), coalesce(${albums.totalDiscs}, 0)), 0)`,
      },
    })
    .returning({ id: albums.id })
    .get().id;
}

export interface Credit {
  readonly artistId: number;
  readonly role: (typeof CREDIT_ROLES)[number];
}

/**
 * Every column is required (null when unknown): a rescan reflects the file as
 * it is now, so a tag removed from the file must clear its column too.
 */
export type TrackValues = Required<Omit<typeof tracks.$inferInsert, 'id'>>;

export interface TrackUpsertInput extends TrackValues {
  /** In tag order; position is assigned per role. */
  readonly credits: readonly Credit[];
  readonly genreIds: readonly number[];
}

/**
 * Upserts the track for a file and replaces its artist and genre links.
 * Runs in its own transaction (a savepoint if already inside one), so a
 * track is never left with half its credits.
 */
export function upsertTrack(db: CatalogExecutor, input: TrackUpsertInput): number {
  const { credits, genreIds, ...values } = input;
  const { fileId: _, ...updatable } = values;

  return db.transaction((tx) => {
    const trackId = tx
      .insert(tracks)
      .values(values)
      .onConflictDoUpdate({ target: tracks.fileId, set: updatable })
      .returning({ id: tracks.id })
      .get().id;

    tx.delete(trackArtists).where(eq(trackArtists.trackId, trackId)).run();
    const rows = positionCredits(credits).map((c) => ({ ...c, trackId }));
    if (rows.length > 0) tx.insert(trackArtists).values(rows).run();

    tx.delete(trackGenres).where(eq(trackGenres.trackId, trackId)).run();
    const genreRows = [...new Set(genreIds)].map((genreId) => ({ trackId, genreId }));
    if (genreRows.length > 0) tx.insert(trackGenres).values(genreRows).run();

    return trackId;
  });
}

export function getTrackByFileId(db: CatalogExecutor, fileId: number): TrackRow | undefined {
  return db.select().from(tracks).where(eq(tracks.fileId, fileId)).get();
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

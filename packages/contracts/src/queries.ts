/**
 * Query-string schemas for the API. Every schema is strict: an unknown
 * parameter is a 400, so typos fail loudly and nothing resembling a
 * filesystem path can reach a handler (docs/safety.md, #7).
 */
import { z } from 'zod';

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const year = z.coerce.number().int().min(1000).max(9999);
const positive = z.coerce.number().int().positive();
const flag = z.enum(['true', 'false']).transform((v) => v === 'true');
const text = z.string().trim().min(1).max(200);

export const SORT_ORDERS = ['asc', 'desc'] as const;

const page = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(48),
  order: z.enum(SORT_ORDERS).default('asc'),
};

export const ALBUM_SORTS = ['artist', 'title', 'year', 'added'] as const;

/**
 * `release`: a real record (3+ tracks, or 20+ minutes, which covers a CD image
 * kept as one file). `loose`: odd tracks kept from records not owned whole.
 */
export const ALBUM_KINDS = ['release', 'loose'] as const;

export const albumListQuery = z.strictObject({
  q: text.optional(),
  artistId: id.optional(),
  genreId: id.optional(),
  yearFrom: year.optional(),
  yearTo: year.optional(),
  codec: text.optional(),
  lossless: flag.optional(),
  minSampleRate: positive.optional(),
  minBitDepth: positive.optional(),
  kind: z.enum(ALBUM_KINDS).optional(),
  sort: z.enum(ALBUM_SORTS).default('artist'),
  ...page,
});
export type AlbumListQuery = z.infer<typeof albumListQuery>;

export const TRACK_SORTS = ['artist', 'title', 'album', 'year', 'duration', 'sampleRate'] as const;

export const trackListQuery = z.strictObject({
  q: text.optional(),
  artistId: id.optional(),
  albumId: id.optional(),
  genreId: id.optional(),
  yearFrom: year.optional(),
  yearTo: year.optional(),
  codec: text.optional(),
  lossless: flag.optional(),
  minSampleRate: positive.optional(),
  bitDepth: positive.optional(),
  /** Seconds. */
  durationMin: z.coerce.number().min(0).optional(),
  /** Seconds. */
  durationMax: z.coerce.number().min(0).optional(),
  sort: z.enum(TRACK_SORTS).default('artist'),
  ...page,
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export type TrackListQuery = z.infer<typeof trackListQuery>;

export const artistListQuery = z.strictObject({
  q: text.optional(),
  sort: z.enum(['name', 'albums']).default('name'),
  ...page,
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ArtistListQuery = z.infer<typeof artistListQuery>;

export const searchQuery = z.strictObject({ q: text });
export type SearchQuery = z.infer<typeof searchQuery>;

export const scanListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const idParams = z.strictObject({ id });

/** `start`: where a converted stream begins, in seconds (seeking). */
export const audioQuery = z.strictObject({
  start: z.coerce
    .number()
    .min(0)
    .max(24 * 3600)
    .optional(),
});

export const artworkQuery = z.strictObject({
  size: z.enum(['sm', 'lg', 'xl']).default('lg'),
});

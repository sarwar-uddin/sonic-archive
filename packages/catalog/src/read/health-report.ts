import type { HealthReport, HealthTrackRef, ReportSection } from '@sonic-archive/contracts';
import type Database from 'better-sqlite3';
import {
  albumMetadataIssues,
  probableDuplicates,
  splitAlbumFolders,
  type TrackFacts,
} from './health-rules.ts';

/** Each section lists at most this many items; `total` is always exact. */
export const REPORT_LIMIT = 200;

type Row = Record<string, unknown>;

interface Facts extends TrackFacts {
  readonly albumTitle: string | null;
  readonly audioMd5: string | null;
}

/**
 * Builds the library health report: missing and unreadable files, albums
 * without artwork or with metadata problems, and three tiers of duplicates.
 * Read-only; computed on request (a few hundred ms at 50k tracks).
 */
export function buildHealthReport(sqlite: Database.Database): HealthReport {
  const all = (sql: string) => sqlite.prepare(sql).all() as Row[];

  const facts: Facts[] = all(
    `SELECT t.id, t.album_id, a.group_key, a.title AS album_title, t.title, t.display_artist,
            (SELECT count(*) FROM track_artists ta WHERE ta.track_id = t.id AND ta.role = 'artist') AS credits,
            t.track_no, t.disc_no, t.year, t.duration_ms, f.rel_path,
            -- One checksum per file: the tracks of a split CD image share it.
            CASE WHEN t.segment = (SELECT min(segment) FROM tracks WHERE file_id = t.file_id)
                 THEN f.audio_md5 END AS audio_md5
     FROM tracks t JOIN files f ON f.id = t.file_id LEFT JOIN albums a ON a.id = t.album_id
     WHERE f.status != 'missing'
     ORDER BY f.rel_path`,
  ).map((r) => ({
    trackId: Number(r.id),
    albumId: r.album_id === null ? null : Number(r.album_id),
    groupKey: (r.group_key as string | null) ?? null,
    albumTitle: (r.album_title as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    displayArtist: (r.display_artist as string | null) ?? null,
    creditCount: Number(r.credits),
    trackNo: r.track_no === null ? null : Number(r.track_no),
    discNo: r.disc_no === null ? null : Number(r.disc_no),
    year: r.year === null ? null : Number(r.year),
    durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    relPath: String(r.rel_path),
    audioMd5: (r.audio_md5 as string | null) ?? null,
  }));

  const albums = new Map(
    all(
      `SELECT a.id, a.title, ar.name AS artist, a.artwork_id FROM albums a
       LEFT JOIN artists ar ON ar.id = a.album_artist_id`,
    ).map((r) => [
      Number(r.id),
      {
        id: Number(r.id),
        title: String(r.title),
        artist: (r.artist as string | null) ?? null,
        hasArtwork: r.artwork_id !== null,
      },
    ]),
  );
  const visibleAlbumIds = [...new Set(facts.map((f) => f.albumId).filter((id) => id !== null))];
  const albumRef = (id: number) => {
    const a = albums.get(id);
    return { id, title: a?.title ?? '', artist: a?.artist ?? null };
  };
  const byAlbumTitle = (a: number, b: number) =>
    (albums.get(a)?.title ?? '').localeCompare(albums.get(b)?.title ?? '');

  const ref = (f: Facts): HealthTrackRef => ({
    trackId: f.trackId,
    title: f.title,
    displayArtist: f.displayArtist,
    durationMs: f.durationMs,
    relPath: f.relPath,
    album: f.albumId === null ? null : { id: f.albumId, title: f.albumTitle ?? '' },
  });

  // Exact duplicates: identical decoded audio.
  const byMd5 = new Map<string, Facts[]>();
  for (const f of facts) {
    if (f.audioMd5 === null) continue;
    const list = byMd5.get(f.audioMd5) ?? [];
    list.push(f);
    byMd5.set(f.audioMd5, list);
  }
  const exact = [...byMd5].filter(([, list]) => list.length > 1);

  const issues = albumMetadataIssues(facts);
  const split = splitAlbumFolders(facts);
  const probable = probableDuplicates(facts, 2000, (group) => {
    const md5 = group[0]?.audioMd5;
    return md5 !== null && md5 !== undefined && group.every((f) => f.audioMd5 === md5);
  });

  const missing = all(
    `SELECT f.rel_path, f.missing_since, t.id AS track_id FROM files f
     LEFT JOIN tracks t ON t.file_id = f.id
       AND t.segment = (SELECT min(segment) FROM tracks WHERE file_id = f.id)
     WHERE f.status = 'missing' ORDER BY f.rel_path`,
  );
  const trackRefs = new Map(
    all(
      `SELECT t.id, t.title, t.display_artist, t.duration_ms, f.rel_path, a.id AS album_id, a.title AS album_title
       FROM tracks t JOIN files f ON f.id = t.file_id LEFT JOIN albums a ON a.id = t.album_id
       WHERE f.status = 'missing'`,
    ).map((r) => [
      Number(r.id),
      {
        trackId: Number(r.id),
        title: (r.title as string | null) ?? null,
        displayArtist: (r.display_artist as string | null) ?? null,
        durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
        relPath: String(r.rel_path),
        album:
          r.album_id === null ? null : { id: Number(r.album_id), title: String(r.album_title) },
      } satisfies HealthTrackRef,
    ]),
  );

  return {
    missingFiles: section(
      missing.map((r) => ({
        relPath: String(r.rel_path),
        missingSince:
          r.missing_since === null ? null : new Date(Number(r.missing_since)).toISOString(),
        track: r.track_id === null ? null : (trackRefs.get(Number(r.track_id)) ?? null),
      })),
    ),
    unreadableFiles: section(
      all(`SELECT rel_path, error_message FROM files WHERE status = 'error' ORDER BY rel_path`).map(
        (r) => ({
          relPath: String(r.rel_path),
          error: (r.error_message as string | null) ?? null,
        }),
      ),
    ),
    missingArtwork: section(
      visibleAlbumIds
        .filter((id) => !albums.get(id)?.hasArtwork)
        .sort(byAlbumTitle)
        .map(albumRef),
    ),
    metadataIssues: section(
      [...issues.keys()]
        .sort(byAlbumTitle)
        .map((id) => ({ album: albumRef(id), issues: issues.get(id) ?? [] })),
    ),
    exactDuplicates: section(
      exact.map(([audioMd5, list]) => ({ audioMd5, tracks: list.map(ref) })),
    ),
    probableDuplicates: section(probable.map((group) => ({ tracks: group.map(ref) }))),
    splitAlbums: section(
      [...split.keys()]
        .sort(byAlbumTitle)
        .map((id) => ({ album: albumRef(id), folders: split.get(id) ?? [] })),
    ),
  };
}

function section<T>(items: T[]): ReportSection<T> {
  return { total: items.length, items: items.slice(0, REPORT_LIMIT) };
}

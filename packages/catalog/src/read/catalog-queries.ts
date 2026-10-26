/**
 * Read model for the API: hand-written SQL that returns the response shapes
 * in `@sonic-archive/contracts` directly.
 *
 * Writes go through Drizzle's query builder (src/db/*-repository.ts); reads
 * here are aggregate-heavy, so they use plain SQL, which is clearer for
 * GROUP BY / CTE queries. Every value is bound as a parameter. The only
 * text spliced into SQL comes from fixed allow-lists (sort keys, directions).
 *
 * "Visible" means the file is not missing: missing files keep their rows
 * (docs/safety.md, #10) but are hidden from browsing.
 */
import type {
  AlbumDetail,
  AlbumListQuery,
  AlbumSummary,
  ArtistDetail,
  ArtistListQuery,
  ArtistRef,
  ArtistSummary,
  Disc,
  Facets,
  Page,
  RipLogSummary,
  RipLogText,
  RipVerdict,
  ScanRecord,
  SearchResults,
  Statistics,
  Stats,
  TrackListItem,
  TrackListQuery,
  TrackSummary,
} from '@sonic-archive/contracts';
import type Database from 'better-sqlite3';
import { toFtsQuery } from '../db/search-index.ts';
import { editionFromPath, pressingCountries } from '../metadata/edition.ts';
import { albumRipVerdict, logDisc, parseRipLog } from '../metadata/rip-log.ts';
import { classifyScan, compareScans } from '../metadata/scans.ts';
import { workKey } from '../metadata/work.ts';
import { nameKey } from '../text/normalize.ts';
import { type Playback, playbackOf } from './playback.ts';

type Row = Record<string, unknown>;
type Param = string | number | null;

/**
 * True for the first track of each file. A CD image split by its CUE sheet
 * has several tracks in one file; file sizes are summed over these only.
 */
const FIRST_OF_FILE = `NOT EXISTS (SELECT 1 FROM tracks t3
  WHERE t3.file_id = t.file_id AND t3.segment < t.segment)`;

const ALBUM_STATS_CTE = `
  album_stats AS (
    SELECT t.album_id AS album_id,
           count(*) AS track_count,
           coalesce(sum(t.duration_ms), 0) AS duration_ms,
           group_concat(DISTINCT t.codec) AS codecs,
           max(t.sample_rate) AS max_sample_rate,
           max(t.bit_depth) AS max_bit_depth,
           min(coalesce(t.lossless, 0)) AS all_lossless,
           coalesce(sum(CASE WHEN ${FIRST_OF_FILE} THEN f.size END), 0) AS total_bytes,
           min(f.rel_path) AS sample_path,
           avg(d.dr_exact) AS dr_exact
    FROM tracks t JOIN files f ON f.id = t.file_id
    LEFT JOIN track_dynamics d ON d.track_id = t.id
    WHERE f.status != 'missing' AND t.album_id IS NOT NULL
    GROUP BY t.album_id
  )`;

const ALBUM_COLUMNS = `
  a.id, a.title, a.year, a.artwork_id, a.album_artist_id, ar.name AS artist_name,
  s.track_count, s.duration_ms, s.codecs, s.max_sample_rate, s.max_bit_depth,
  s.all_lossless, s.total_bytes, s.sample_path, s.dr_exact`;

/** See ALBUM_KINDS in contracts: what counts as a whole release. */
export const RELEASE_MIN_TRACKS = 3;
export const RELEASE_MIN_MS = 20 * 60 * 1000;
const IS_RELEASE_SQL = `(s.track_count >= ${RELEASE_MIN_TRACKS} OR s.duration_ms >= ${RELEASE_MIN_MS})`;

const ALBUM_SORT_SQL: Record<AlbumListQuery['sort'], (dir: string) => string> = {
  artist: (d) =>
    `sort_key(coalesce(ar.sort_name, ar.name)) ${d} NULLS LAST, a.year ${d}, sort_key(a.title) ${d}`,
  title: (d) => `sort_key(a.title) ${d}`,
  year: (d) => `a.year ${d} NULLS LAST, sort_key(coalesce(ar.sort_name, ar.name))`,
  added: (d) => `a.created_at ${d}`,
};

const TRACK_COLUMNS = `
  t.id, t.title, t.display_artist, t.track_no, t.disc_no, t.year, t.duration_ms, t.codec,
  t.container, t.lossless, t.sample_rate, t.bit_depth, t.channels, t.bitrate,
  t.has_embedded_art, t.start_ms, t.end_ms, t.segment, f.id AS file_id, f.rel_path, f.size, f.status,
  f.audio_md5, (SELECT dr_exact FROM track_dynamics WHERE track_id = t.id) AS dr_exact,
  (SELECT peak_db FROM track_dynamics WHERE track_id = t.id) AS peak_db`;

const TRACK_SORT_SQL: Record<TrackListQuery['sort'], (dir: string) => string> = {
  artist: (d) =>
    `sort_key(t.display_artist) ${d} NULLS LAST, sort_key(a.title), t.disc_no, t.track_no`,
  title: (d) => `sort_key(t.title) ${d} NULLS LAST`,
  album: (d) => `sort_key(a.title) ${d} NULLS LAST, t.disc_no, t.track_no`,
  year: (d) => `t.year ${d} NULLS LAST, sort_key(a.title), t.disc_no, t.track_no`,
  duration: (d) => `t.duration_ms ${d} NULLS LAST`,
  sampleRate: (d) => `t.sample_rate ${d} NULLS LAST, t.bit_depth ${d} NULLS LAST`,
};

export interface CatalogQueries {
  listAlbums(query: AlbumListQuery): Page<AlbumSummary>;
  getAlbum(id: number): AlbumDetail | null;
  listTracks(query: TrackListQuery): Page<TrackListItem>;
  listArtists(query: ArtistListQuery): Page<ArtistSummary>;
  getArtist(id: number): ArtistDetail | null;
  facets(): Facets;
  stats(): Stats;
  statistics(): Statistics;
  search(q: string): SearchResults;
  listScans(limit: number): ScanRecord[];
  getScan(id: number): ScanRecord | null;
  lastScan(): ScanRecord | null;
  getArtwork(id: number): { cacheFile: string; mime: string } | null;
  getRipLog(id: number): RipLogText | null;
  /** A present audio file to stream, with how to stream it. */
  getAudioFile(id: number): { relPath: string; playback: Playback; codec: string | null } | null;
  /** Rip verdict per album that has logs. */
  ripVerdicts(): ReadonlyMap<number, RipVerdict>;
}

export function createCatalogQueries(sqlite: Database.Database): CatalogQueries {
  // SQLite's NOCASE collation folds ASCII only, which would sort "Ísold" after
  // "Various Artists". sort_key() applies the same folding as artist identity.
  sqlite.function('sort_key', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? nameKey(value) : null,
  );
  const statements = new Map<string, Database.Statement>();
  const prepare = (text: string) => {
    let statement = statements.get(text);
    if (!statement) {
      statement = sqlite.prepare(text);
      statements.set(text, statement);
    }
    return statement;
  };
  const all = (text: string, params: readonly Param[] = []) =>
    prepare(text).all(...params) as Row[];
  const get = (text: string, params: readonly Param[] = []) =>
    prepare(text).get(...params) as Row | undefined;

  // Album rip verdicts come from parsing every stored log (about a
  // millisecond each). They are cached until the logs change, which the
  // scanner (another process) may do at any time.
  let ripCache: { signature: string; verdicts: Map<number, RipVerdict> } | null = null;
  const ripVerdicts = (): Map<number, RipVerdict> => {
    const sig = get(`SELECT count(*) AS n, coalesce(max(id), 0) AS m,
      coalesce(sum(source_size + source_mtime_ms), 0) AS s FROM rip_logs`);
    const signature = `${sig?.n}:${sig?.m}:${sig?.s}`;
    if (ripCache?.signature !== signature) {
      const byAlbum = new Map<number, { relPath: string; verdict: RipVerdict }[]>();
      for (const row of all('SELECT album_id, rel_path, text FROM rip_logs')) {
        const list = byAlbum.get(Number(row.album_id)) ?? [];
        list.push({
          relPath: String(row.rel_path),
          verdict: parseRipLog(String(row.text)).verdict,
        });
        byAlbum.set(Number(row.album_id), list);
      }
      const verdicts = new Map<number, RipVerdict>();
      for (const [albumId, logs] of byAlbum) {
        const verdict = albumRipVerdict(logs);
        if (verdict !== null) verdicts.set(albumId, verdict);
      }
      ripCache = { signature, verdicts };
    }
    return ripCache.verdicts;
  };
  // Pressing groups: albums sharing an artist and title. Cached like rip
  // verdicts, until the set of albums changes.
  let pressingCache: { signature: string; groups: Map<number, number[]> } | null = null;
  const pressingGroups = (): Map<number, number[]> => {
    const sig = get(`SELECT count(*) AS n, coalesce(max(id), 0) AS m,
      coalesce(total(length(title) + coalesce(album_artist_id, 0)), 0) AS s,
      (SELECT count(*) FROM files WHERE status = 'missing') AS missing FROM albums`);
    const signature = `${sig?.n}:${sig?.m}:${sig?.s}:${sig?.missing}`;
    if (pressingCache?.signature !== signature) {
      const byWork = new Map<string, number[]>();
      for (const row of all(
        `SELECT a.id, a.title, ar.name AS artist FROM albums a
         LEFT JOIN artists ar ON ar.id = a.album_artist_id
         WHERE a.id IN (SELECT album_id FROM tracks t JOIN files f ON f.id = t.file_id
                        WHERE f.status != 'missing')`,
      )) {
        const key = workKey(nullableString(row.artist), String(row.title));
        if (key === null) continue;
        byWork.set(key, [...(byWork.get(key) ?? []), Number(row.id)]);
      }
      const groups = new Map<number, number[]>();
      for (const ids of byWork.values()) {
        if (ids.length > 1) for (const id of ids) groups.set(id, ids);
      }
      pressingCache = { signature, groups };
    }
    return pressingCache.groups;
  };
  const summarize = (row: Row) =>
    toAlbumSummary(
      row,
      ripVerdicts().get(Number(row.id)) ?? null,
      pressingGroups().get(Number(row.id))?.length ?? 1,
    );

  /** Track ids matching free text, as an SQL fragment, or null for "no match possible". */
  const ftsTrackIds = (q: string) => {
    const fts = toFtsQuery(q);
    return fts === null
      ? null
      : { sql: 'SELECT rowid FROM track_search WHERE track_search MATCH ?', param: fts };
  };

  function albumFilters(
    query: Partial<AlbumListQuery>,
  ): { where: string[]; params: Param[] } | null {
    const where: string[] = [];
    const params: Param[] = [];
    if (query.q !== undefined) {
      const fts = ftsTrackIds(query.q);
      if (fts === null) return null;
      where.push(`a.id IN (SELECT album_id FROM tracks WHERE id IN (${fts.sql}))`);
      params.push(fts.param);
    }
    if (query.artistId !== undefined) {
      where.push(`(a.album_artist_id = ? OR EXISTS (
        SELECT 1 FROM tracks t2 JOIN track_artists ta ON ta.track_id = t2.id
        WHERE t2.album_id = a.id AND ta.artist_id = ?))`);
      params.push(query.artistId, query.artistId);
    }
    if (query.genreId !== undefined) {
      where.push(`EXISTS (SELECT 1 FROM tracks t2 JOIN track_genres tg ON tg.track_id = t2.id
        WHERE t2.album_id = a.id AND tg.genre_id = ?)`);
      params.push(query.genreId);
    }
    if (query.yearFrom !== undefined) {
      where.push('a.year >= ?');
      params.push(query.yearFrom);
    }
    if (query.yearTo !== undefined) {
      where.push('a.year <= ?');
      params.push(query.yearTo);
    }
    if (query.codec !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM tracks t2 WHERE t2.album_id = a.id AND t2.codec = ? COLLATE NOCASE)',
      );
      params.push(query.codec);
    }
    if (query.lossless !== undefined) where.push(`s.all_lossless = ${query.lossless ? 1 : 0}`);
    if (query.kind !== undefined) {
      where.push(query.kind === 'release' ? IS_RELEASE_SQL : `NOT ${IS_RELEASE_SQL}`);
    }
    if (query.minSampleRate !== undefined) {
      where.push('s.max_sample_rate >= ?');
      params.push(query.minSampleRate);
    }
    if (query.minBitDepth !== undefined) {
      where.push('s.max_bit_depth >= ?');
      params.push(query.minBitDepth);
    }
    return { where, params };
  }

  function selectAlbums(
    filters: { where: string[]; params: Param[] },
    orderBy: string,
    limit: number,
    offset: number,
  ): AlbumSummary[] {
    const where = filters.where.length > 0 ? `WHERE ${filters.where.join(' AND ')}` : '';
    return all(
      `WITH ${ALBUM_STATS_CTE}
       SELECT ${ALBUM_COLUMNS}
       FROM albums a JOIN album_stats s ON s.album_id = a.id
       LEFT JOIN artists ar ON ar.id = a.album_artist_id
       ${where}
       ORDER BY ${orderBy}, a.id
       LIMIT ? OFFSET ?`,
      [...filters.params, limit, offset],
    ).map(summarize);
  }

  function countAlbums(filters: { where: string[]; params: Param[] }): number {
    const where = filters.where.length > 0 ? `WHERE ${filters.where.join(' AND ')}` : '';
    const row = get(
      `WITH ${ALBUM_STATS_CTE}
       SELECT count(*) AS n FROM albums a JOIN album_stats s ON s.album_id = a.id
       LEFT JOIN artists ar ON ar.id = a.album_artist_id ${where}`,
      filters.params,
    );
    return Number(row?.n ?? 0);
  }

  function listAlbums(query: AlbumListQuery): Page<AlbumSummary> {
    const filters = albumFilters(query);
    const empty = { items: [], page: query.page, limit: query.limit, total: 0 };
    if (filters === null) return empty;
    const dir = query.order === 'desc' ? 'DESC' : 'ASC';
    return {
      items: selectAlbums(
        filters,
        ALBUM_SORT_SQL[query.sort](dir),
        query.limit,
        (query.page - 1) * query.limit,
      ),
      page: query.page,
      limit: query.limit,
      total: countAlbums(filters),
    };
  }

  function trackArtists(trackIds: readonly number[]): Map<number, ArtistRef[]> {
    const out = new Map<number, ArtistRef[]>();
    if (trackIds.length === 0) return out;
    const rows = all(
      `SELECT ta.track_id, ar.id, ar.name FROM track_artists ta
       JOIN artists ar ON ar.id = ta.artist_id
       WHERE ta.role = 'artist' AND ta.track_id IN (SELECT value FROM json_each(?))
       ORDER BY ta.track_id, ta.position`,
      [JSON.stringify(trackIds)],
    );
    for (const row of rows) {
      const list = out.get(Number(row.track_id)) ?? [];
      list.push({ id: Number(row.id), name: String(row.name) });
      out.set(Number(row.track_id), list);
    }
    return out;
  }

  function getAlbum(id: number): AlbumDetail | null {
    const row = get(
      `WITH ${ALBUM_STATS_CTE}
       SELECT ${ALBUM_COLUMNS}, a.musicbrainz_album_id, a.total_discs
       FROM albums a LEFT JOIN album_stats s ON s.album_id = a.id
       LEFT JOIN artists ar ON ar.id = a.album_artist_id
       WHERE a.id = ?`,
      [id],
    );
    if (!row) return null;

    const trackRows = all(
      `SELECT ${TRACK_COLUMNS} FROM tracks t JOIN files f ON f.id = t.file_id
       WHERE t.album_id = ?
       ORDER BY t.disc_no NULLS FIRST, t.track_no NULLS LAST, sort_key(t.title), t.id`,
      [id],
    );
    const credits = trackArtists(trackRows.map((r) => Number(r.id)));
    const discs: { discNo: number | null; tracks: TrackSummary[] }[] = [];
    for (const trackRow of trackRows) {
      const track = toTrackSummary(trackRow, credits);
      const last = discs.at(-1);
      if (last && last.discNo === track.discNo) last.tracks.push(track);
      else discs.push({ discNo: track.discNo, tracks: [track] });
    }

    return {
      ...summarize(row),
      musicbrainzAlbumId: nullableString(row.musicbrainz_album_id),
      totalDiscs: nullableNumber(row.total_discs),
      totalBytes: Number(row.total_bytes ?? 0),
      genres: all(
        `SELECT DISTINCT g.id, g.name FROM genres g
         JOIN track_genres tg ON tg.genre_id = g.id JOIN tracks t ON t.id = tg.track_id
         WHERE t.album_id = ? ORDER BY sort_key(g.name)`,
        [id],
      ).map((g) => ({ id: Number(g.id), name: String(g.name) })),
      discs: discs as Disc[],
      otherPressings: selectAlbums(
        {
          where: ['a.id IN (SELECT value FROM json_each(?))', 'a.id != ?'],
          params: [JSON.stringify(pressingGroups().get(id) ?? []), id],
        },
        ALBUM_SORT_SQL.year('ASC'),
        100,
        0,
      ),
      ripLogs: all('SELECT id, rel_path, text FROM rip_logs WHERE album_id = ? ORDER BY rel_path', [
        id,
      ]).map((r): RipLogSummary => {
        const relPath = String(r.rel_path);
        return {
          id: Number(r.id),
          label: relPath.split('/').at(-1) ?? relPath,
          disc: logDisc(relPath),
          ...parseRipLog(String(r.text)),
        };
      }),
      scans: all(
        `SELECT i.rel_path, w.id, w.width, w.height FROM album_images i
         JOIN artwork w ON w.id = i.artwork_id WHERE i.album_id = ?`,
        [id],
      )
        .sort((a, b) => compareScans(String(a.rel_path), String(b.rel_path)))
        .map((r) => ({
          artworkId: Number(r.id),
          ...classifyScan(String(r.rel_path)),
          width: nullableNumber(r.width),
          height: nullableNumber(r.height),
        })),
    };
  }

  function listTracks(query: TrackListQuery): Page<TrackListItem> {
    const where: string[] = ["f.status != 'missing'"];
    const params: Param[] = [];
    const empty = { items: [], page: query.page, limit: query.limit, total: 0 };
    if (query.q !== undefined) {
      const fts = ftsTrackIds(query.q);
      if (fts === null) return empty;
      where.push(`t.id IN (${fts.sql})`);
      params.push(fts.param);
    }
    if (query.artistId !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM track_artists ta WHERE ta.track_id = t.id AND ta.artist_id = ?)',
      );
      params.push(query.artistId);
    }
    if (query.albumId !== undefined) {
      where.push('t.album_id = ?');
      params.push(query.albumId);
    }
    if (query.genreId !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM track_genres tg WHERE tg.track_id = t.id AND tg.genre_id = ?)',
      );
      params.push(query.genreId);
    }
    const ranges: [string, number | undefined][] = [
      ['t.year >= ?', query.yearFrom],
      ['t.year <= ?', query.yearTo],
      ['t.sample_rate >= ?', query.minSampleRate],
      ['t.bit_depth = ?', query.bitDepth],
      [
        't.duration_ms >= ?',
        query.durationMin === undefined ? undefined : query.durationMin * 1000,
      ],
      [
        't.duration_ms <= ?',
        query.durationMax === undefined ? undefined : query.durationMax * 1000,
      ],
    ];
    for (const [clause, value] of ranges) {
      if (value !== undefined) {
        where.push(clause);
        params.push(value);
      }
    }
    if (query.codec !== undefined) {
      where.push('t.codec = ? COLLATE NOCASE');
      params.push(query.codec);
    }
    if (query.lossless !== undefined) where.push(`t.lossless = ${query.lossless ? 1 : 0}`);

    const from = `FROM tracks t JOIN files f ON f.id = t.file_id
                  LEFT JOIN albums a ON a.id = t.album_id WHERE ${where.join(' AND ')}`;
    const dir = query.order === 'desc' ? 'DESC' : 'ASC';
    const rows = all(
      `SELECT ${TRACK_COLUMNS}, a.id AS album_id, a.title AS album_title, a.artwork_id AS album_artwork_id
       ${from} ORDER BY ${TRACK_SORT_SQL[query.sort](dir)}, t.id LIMIT ? OFFSET ?`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    return {
      items: toTrackListItems(rows),
      page: query.page,
      limit: query.limit,
      total: Number(get(`SELECT count(*) AS n ${from}`, params)?.n ?? 0),
    };
  }

  function toTrackListItems(rows: Row[]): TrackListItem[] {
    const credits = trackArtists(rows.map((r) => Number(r.id)));
    return rows.map((row) => ({
      ...toTrackSummary(row, credits),
      album:
        row.album_id === null || row.album_id === undefined
          ? null
          : {
              id: Number(row.album_id),
              title: String(row.album_title),
              artworkId: nullableNumber(row.album_artwork_id),
            },
    }));
  }

  /** Artist credits on visible tracks: performer credits plus album-artist credits. */
  const CREDITED_CTE = `
    visible AS (
      SELECT t.id, t.album_id FROM tracks t JOIN files f ON f.id = t.file_id
      WHERE f.status != 'missing'
    ),
    credited AS (
      SELECT ta.artist_id, v.id AS track_id, v.album_id
      FROM track_artists ta JOIN visible v ON v.id = ta.track_id WHERE ta.role = 'artist'
      UNION
      SELECT a.album_artist_id, v.id, v.album_id
      FROM albums a JOIN visible v ON v.album_id = a.id WHERE a.album_artist_id IS NOT NULL
    )`;

  function listArtists(query: ArtistListQuery): Page<ArtistSummary> {
    const where: string[] = [];
    const params: Param[] = [];
    if (query.q !== undefined) {
      where.push("ar.name_key LIKE ? ESCAPE '\\'");
      params.push(`%${nameKey(query.q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const dir = query.order === 'desc' ? 'DESC' : 'ASC';
    const orderBy =
      query.sort === 'albums'
        ? `album_count ${dir}, sort_key(coalesce(ar.sort_name, ar.name))`
        : `sort_key(coalesce(ar.sort_name, ar.name)) ${dir}`;
    const base = `WITH ${CREDITED_CTE}
      SELECT ar.id, ar.name, count(DISTINCT c.album_id) AS album_count,
             count(DISTINCT c.track_id) AS track_count,
             (SELECT group_concat(artwork_id) FROM (
                SELECT a2.artwork_id, min(a2.album_artist_id IS NOT ar.id) AS appearance,
                       min(a2.year) AS year
                FROM albums a2
                WHERE a2.artwork_id IS NOT NULL
                  AND a2.id IN (SELECT c2.album_id FROM credited c2 WHERE c2.artist_id = ar.id)
                GROUP BY a2.artwork_id
                ORDER BY appearance, year
                LIMIT 4)) AS artwork_ids
      FROM artists ar JOIN credited c ON c.artist_id = ar.id ${whereSql}
      GROUP BY ar.id`;
    const rows = all(`${base} ORDER BY ${orderBy}, ar.id LIMIT ? OFFSET ?`, [
      ...params,
      query.limit,
      (query.page - 1) * query.limit,
    ]);
    return {
      items: rows.map(toArtistSummary),
      page: query.page,
      limit: query.limit,
      total: Number(get(`SELECT count(*) AS n FROM (${base})`, params)?.n ?? 0),
    };
  }

  function getArtist(id: number): ArtistDetail | null {
    const artist = get('SELECT id, name FROM artists WHERE id = ?', [id]);
    if (!artist) return null;
    const own = selectAlbums(
      { where: ['a.album_artist_id = ?'], params: [id] },
      ALBUM_SORT_SQL.year('ASC'),
      1000,
      0,
    );
    const appearsOn = selectAlbums(
      {
        where: [
          `(a.album_artist_id IS NULL OR a.album_artist_id != ?)`,
          `EXISTS (SELECT 1 FROM tracks t2 JOIN track_artists ta ON ta.track_id = t2.id
                   WHERE t2.album_id = a.id AND ta.artist_id = ?)`,
        ],
        params: [id, id],
      },
      ALBUM_SORT_SQL.year('ASC'),
      1000,
      0,
    );
    const trackCount = get(
      `WITH ${CREDITED_CTE} SELECT count(DISTINCT track_id) AS n FROM credited WHERE artist_id = ?`,
      [id],
    );
    return {
      id: Number(artist.id),
      name: String(artist.name),
      albums: own,
      appearsOn,
      trackCount: Number(trackCount?.n ?? 0),
    };
  }

  function facets(): Facets {
    const visibleFile = `JOIN files f ON f.id = t.file_id AND f.status != 'missing'`;
    return {
      genres: all(
        `SELECT g.id, g.name, count(DISTINCT t.album_id) AS n FROM genres g
         JOIN track_genres tg ON tg.genre_id = g.id JOIN tracks t ON t.id = tg.track_id
         ${visibleFile}
         GROUP BY g.id ORDER BY sort_key(g.name)`,
      ).map((r) => ({ id: Number(r.id), name: String(r.name), albumCount: Number(r.n) })),
      years: all(
        `SELECT a.year, count(DISTINCT a.id) AS n FROM albums a
         JOIN tracks t ON t.album_id = a.id ${visibleFile}
         WHERE a.year IS NOT NULL GROUP BY a.year ORDER BY a.year`,
      ).map((r) => ({ year: Number(r.year), albumCount: Number(r.n) })),
      codecs: all(
        `SELECT t.codec, count(*) AS n FROM tracks t ${visibleFile} WHERE t.codec IS NOT NULL
         GROUP BY t.codec ORDER BY n DESC, t.codec`,
      ).map((r) => ({ codec: String(r.codec), trackCount: Number(r.n) })),
      sampleRates: all(
        `SELECT t.sample_rate, count(*) AS n FROM tracks t ${visibleFile}
         WHERE t.sample_rate IS NOT NULL GROUP BY t.sample_rate ORDER BY t.sample_rate`,
      ).map((r) => ({ sampleRate: Number(r.sample_rate), trackCount: Number(r.n) })),
      bitDepths: all(
        `SELECT t.bit_depth, count(*) AS n FROM tracks t ${visibleFile}
         WHERE t.bit_depth IS NOT NULL GROUP BY t.bit_depth ORDER BY t.bit_depth`,
      ).map((r) => ({ bitDepth: Number(r.bit_depth), trackCount: Number(r.n) })),
    };
  }

  function stats(): Stats {
    const totals = get(
      `SELECT count(*) AS tracks, coalesce(sum(t.duration_ms), 0) AS duration_ms,
              coalesce(sum(CASE WHEN ${FIRST_OF_FILE} THEN f.size END), 0) AS total_bytes,
              count(DISTINCT t.album_id) AS albums
       FROM tracks t JOIN files f ON f.id = t.file_id WHERE f.status != 'missing'`,
    );
    const files = get(
      `SELECT sum(status = 'missing') AS missing, sum(status = 'error') AS errors FROM files`,
    );
    const artists = get(`WITH ${CREDITED_CTE} SELECT count(DISTINCT artist_id) AS n FROM credited`);
    return {
      albums: Number(totals?.albums ?? 0),
      artists: Number(artists?.n ?? 0),
      tracks: Number(totals?.tracks ?? 0),
      durationMs: Number(totals?.duration_ms ?? 0),
      totalBytes: Number(totals?.total_bytes ?? 0),
      missingFiles: Number(files?.missing ?? 0),
      errorFiles: Number(files?.errors ?? 0),
      formats: all(
        `SELECT t.codec, t.sample_rate, t.bit_depth, count(*) AS n
         FROM tracks t JOIN files f ON f.id = t.file_id WHERE f.status != 'missing'
         GROUP BY t.codec, t.sample_rate, t.bit_depth ORDER BY n DESC`,
      ).map((r) => ({
        codec: nullableString(r.codec),
        sampleRate: nullableNumber(r.sample_rate),
        bitDepth: nullableNumber(r.bit_depth),
        trackCount: Number(r.n),
      })),
    };
  }

  /** Charts for the ledger, over releases only: loose tracks would skew per-album counts. */
  function statistics(): Statistics {
    const releases = all(
      `WITH ${ALBUM_STATS_CTE}
       SELECT a.id, a.title, a.year, s.sample_path, s.dr_exact FROM albums a
       JOIN album_stats s ON s.album_id = a.id WHERE ${IS_RELEASE_SQL}`,
    );
    const count = <K>(keys: K[]) => {
      const counts = new Map<K, number>();
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    };
    const decades = count(
      releases.filter((r) => r.year !== null).map((r) => Math.floor(Number(r.year) / 10) * 10),
    );
    const origins = count(
      releases.flatMap((r) =>
        pressingCountries(editionFromPath(String(r.sample_path), String(r.title))),
      ),
    );
    const verdicts = ripVerdicts();
    const rips = count(releases.map((r) => verdicts.get(Number(r.id)) ?? ('none' as const)));
    const ids = JSON.stringify(releases.map((r) => Number(r.id)));
    return {
      releases: releases.length,
      decades: [...decades]
        .sort(([a], [b]) => a - b)
        .map(([decade, n]) => ({ decade, releases: n })),
      undated: releases.filter((r) => r.year === null).length,
      origins: [...origins]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([country, n]) => ({ country, releases: n })),
      genres: all(
        `SELECT g.id, g.name, count(DISTINCT t.album_id) AS n FROM genres g
         JOIN track_genres tg ON tg.genre_id = g.id JOIN tracks t ON t.id = tg.track_id
         WHERE t.album_id IN (SELECT value FROM json_each(?))
         GROUP BY g.id ORDER BY n DESC, sort_key(g.name) LIMIT 10`,
        [ids],
      ).map((r) => ({ id: Number(r.id), name: String(r.name), releases: Number(r.n) })),
      artists: all(
        `SELECT ar.id, ar.name, count(*) AS n FROM albums a JOIN artists ar ON ar.id = a.album_artist_id
         WHERE a.id IN (SELECT value FROM json_each(?))
         GROUP BY ar.id ORDER BY n DESC, sort_key(ar.name) LIMIT 10`,
        [ids],
      ).map((r) => ({ id: Number(r.id), name: String(r.name), releases: Number(r.n) })),
      dynamicsByDecade: (() => {
        const byDecade = new Map<number, number[]>();
        for (const r of releases) {
          if (r.year === null || r.dr_exact === null) continue;
          const decade = Math.floor(Number(r.year) / 10) * 10;
          byDecade.set(decade, [...(byDecade.get(decade) ?? []), Number(r.dr_exact)]);
        }
        return [...byDecade]
          .sort(([a], [b]) => a - b)
          .map(([decade, values]) => ({
            decade,
            dr: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
            releases: values.length,
          }));
      })(),
      rips: (['verified', 'clean', 'differs', 'problems', 'unknown', 'none'] as const)
        .map((verdict) => ({ verdict, releases: rips.get(verdict) ?? 0 }))
        .filter((r) => r.releases > 0),
    };
  }

  function search(q: string): SearchResults {
    const albumFilter = albumFilters({ q });
    const albums =
      albumFilter === null ? [] : selectAlbums(albumFilter, ALBUM_SORT_SQL.artist('ASC'), 8, 0);
    const artists = listArtists({ q, sort: 'albums', order: 'desc', page: 1, limit: 8 }).items;
    const fts = toFtsQuery(q);
    const tracks =
      fts === null
        ? []
        : toTrackListItems(
            all(
              `SELECT ${TRACK_COLUMNS}, a.id AS album_id, a.title AS album_title,
                      a.artwork_id AS album_artwork_id
               FROM track_search s JOIN tracks t ON t.id = s.rowid
               JOIN files f ON f.id = t.file_id LEFT JOIN albums a ON a.id = t.album_id
               WHERE track_search MATCH ? AND f.status != 'missing'
               ORDER BY s.rank, t.id LIMIT 20`,
              [fts],
            ),
          );
    return { albums, artists, tracks };
  }

  const SCAN_SQL = `SELECT id, status, mode, scope_subpath, started_at, finished_at, seen, added,
    updated, unchanged, missing, restored, errors, error_message FROM scans`;

  return {
    listAlbums,
    getAlbum,
    listTracks,
    listArtists,
    getArtist,
    facets,
    stats,
    statistics,
    search,
    listScans: (limit) => all(`${SCAN_SQL} ORDER BY id DESC LIMIT ?`, [limit]).map(toScanRecord),
    getScan: (id) => {
      const row = get(`${SCAN_SQL} WHERE id = ?`, [id]);
      return row ? toScanRecord(row) : null;
    },
    lastScan: () => {
      const row = get(`${SCAN_SQL} ORDER BY id DESC LIMIT 1`);
      return row ? toScanRecord(row) : null;
    },
    getRipLog: (id) => {
      const row = get('SELECT id, album_id, rel_path, text FROM rip_logs WHERE id = ?', [id]);
      if (!row) return null;
      const relPath = String(row.rel_path);
      return {
        id: Number(row.id),
        albumId: Number(row.album_id),
        label: relPath.split('/').at(-1) ?? relPath,
        text: String(row.text),
      };
    },
    ripVerdicts,
    getAudioFile: (id) => {
      const row = get(
        `SELECT f.rel_path, (SELECT t.codec FROM tracks t WHERE t.file_id = f.id LIMIT 1) AS codec
         FROM files f WHERE f.id = ? AND f.status = 'present'`,
        [id],
      );
      if (!row) return null;
      const relPath = String(row.rel_path);
      const codec = nullableString(row.codec);
      return { relPath, codec, playback: playbackOf(relPath, codec) };
    },
    getArtwork: (id) => {
      const row = get('SELECT cache_file, mime FROM artwork WHERE id = ?', [id]);
      return row ? { cacheFile: String(row.cache_file), mime: String(row.mime) } : null;
    },
  };
}

function toAlbumSummary(row: Row, rip: RipVerdict | null, pressings: number): AlbumSummary {
  const trackCount = Number(row.track_count ?? 0);
  const durationMs = Number(row.duration_ms ?? 0);
  return {
    id: Number(row.id),
    title: String(row.title),
    albumArtist:
      row.album_artist_id === null || row.album_artist_id === undefined
        ? null
        : { id: Number(row.album_artist_id), name: String(row.artist_name) },
    year: nullableNumber(row.year),
    artworkId: nullableNumber(row.artwork_id),
    trackCount,
    durationMs,
    codecs: typeof row.codecs === 'string' && row.codecs !== '' ? row.codecs.split(',') : [],
    maxSampleRate: nullableNumber(row.max_sample_rate),
    maxBitDepth: nullableNumber(row.max_bit_depth),
    lossless: Number(row.all_lossless ?? 0) === 1,
    kind: trackCount >= RELEASE_MIN_TRACKS || durationMs >= RELEASE_MIN_MS ? 'release' : 'loose',
    edition:
      typeof row.sample_path === 'string'
        ? editionFromPath(row.sample_path, String(row.title))
        : [],
    rip,
    pressings,
    dr:
      row.dr_exact === null || row.dr_exact === undefined
        ? null
        : Math.round(Number(row.dr_exact)) || 0,
  };
}

function toTrackSummary(row: Row, credits: Map<number, ArtistRef[]>): TrackSummary {
  return {
    id: Number(row.id),
    title: nullableString(row.title),
    displayArtist: nullableString(row.display_artist),
    artists: credits.get(Number(row.id)) ?? [],
    trackNo: nullableNumber(row.track_no),
    discNo: nullableNumber(row.disc_no),
    year: nullableNumber(row.year),
    durationMs: nullableNumber(row.duration_ms),
    codec: nullableString(row.codec),
    container: nullableString(row.container),
    lossless:
      row.lossless === null || row.lossless === undefined ? null : Number(row.lossless) === 1,
    sampleRate: nullableNumber(row.sample_rate),
    bitDepth: nullableNumber(row.bit_depth),
    channels: nullableNumber(row.channels),
    bitrate: nullableNumber(row.bitrate),
    hasEmbeddedArt: Number(row.has_embedded_art) === 1,
    dr:
      row.dr_exact === null || row.dr_exact === undefined
        ? null
        : Math.round(Number(row.dr_exact)) || 0,
    peakDb: nullableNumber(row.peak_db),
    span:
      Number(row.segment ?? 0) === 0
        ? null
        : { startMs: Number(row.start_ms), endMs: nullableNumber(row.end_ms) },
    file: {
      id: Number(row.file_id),
      playback: playbackOf(String(row.rel_path), nullableString(row.codec)).mode,
      relPath: String(row.rel_path),
      size: Number(row.size),
      status: row.status as TrackSummary['file']['status'],
      audioMd5: nullableString(row.audio_md5),
    },
  };
}

function toArtistSummary(row: Row): ArtistSummary {
  return {
    id: Number(row.id),
    name: String(row.name),
    albumCount: Number(row.album_count),
    trackCount: Number(row.track_count),
    artworkIds:
      typeof row.artwork_ids === 'string' && row.artwork_ids !== ''
        ? row.artwork_ids.split(',').map(Number)
        : [],
  };
}

function toScanRecord(row: Row): ScanRecord {
  return {
    id: Number(row.id),
    status: row.status as ScanRecord['status'],
    mode: row.mode as ScanRecord['mode'],
    scopeSubpath: nullableString(row.scope_subpath),
    startedAt: new Date(Number(row.started_at)).toISOString(),
    finishedAt: row.finished_at === null ? null : new Date(Number(row.finished_at)).toISOString(),
    seen: Number(row.seen),
    added: Number(row.added),
    updated: Number(row.updated),
    unchanged: Number(row.unchanged),
    missing: Number(row.missing),
    restored: Number(row.restored),
    errors: Number(row.errors),
    errorMessage: nullableString(row.error_message),
  };
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

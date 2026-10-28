/**
 * Response shapes. Plain types (no runtime code), shared by the server, which
 * produces them, and the web app, which consumes them.
 */

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface ArtistRef {
  readonly id: number;
  readonly name: string;
}

export interface AlbumSummary {
  readonly id: number;
  readonly title: string;
  readonly albumArtist: ArtistRef | null;
  readonly year: number | null;
  readonly artworkId: number | null;
  readonly trackCount: number;
  readonly durationMs: number;
  /** Distinct codecs among the album's tracks, e.g. ["FLAC"]. */
  readonly codecs: readonly string[];
  readonly maxSampleRate: number | null;
  readonly maxBitDepth: number | null;
  /** True only if every track is lossless. */
  readonly lossless: boolean;
  readonly kind: 'release' | 'loose';
  /** Pressing details from the folder name, e.g. ["1991 Japan TECP-23893 Teichiku"]. */
  readonly edition: readonly string[];
  /** What the album's rip logs say, worst disc first; null without logs. */
  readonly rip: RipVerdict | null;
  /** How many pressings of this album the collection holds, this one included. */
  readonly pressings: number;
  /** Dynamic range (DR meter), the rounded mean of measured tracks; null until analyzed. */
  readonly dr: number | null;
  /** The folder has a scan of the OBI strip: a Japanese pressing with its OBI. */
  readonly obi: boolean;
}

/**
 * How trustworthy a rip is, from its EAC/XLD/CUETools log:
 * `verified` matched AccurateRip or the CUETools database; `clean` was
 * ripped securely without errors but had nothing to compare against;
 * `differs` had no errors but other checksums in AccurateRip (usually another
 * pressing); `problems` reported read errors or CRC mismatches.
 */
export type RipVerdict = 'verified' | 'clean' | 'differs' | 'problems' | 'unknown';

export interface RipLogSummary {
  readonly id: number;
  /** File name of the log. */
  readonly label: string;
  /** The disc folder it belongs to ("CD2"), or null for the whole album. */
  readonly disc: string | null;
  readonly tool: 'EAC' | 'XLD' | 'CUETools' | 'other';
  readonly toolVersion: string | null;
  readonly drive: string | null;
  readonly readMode: string | null;
  readonly secureMode: boolean | null;
  readonly readOffset: number | null;
  readonly crcChecks: number;
  readonly crcMismatches: number;
  readonly readProblems: number;
  readonly accurateRip: {
    readonly accurate: number;
    readonly inaccurate: number;
    readonly notInDatabase: number;
    readonly minConfidence: number | null;
  } | null;
  readonly ctdb: { readonly tracks: number; readonly accurate: number } | null;
  readonly hasChecksum: boolean;
  readonly verdict: RipVerdict;
}

export interface RipLogText {
  readonly id: number;
  readonly albumId: number;
  readonly label: string;
  readonly text: string;
}

export interface TrackSummary {
  readonly id: number;
  readonly title: string | null;
  readonly displayArtist: string | null;
  readonly artists: readonly ArtistRef[];
  readonly trackNo: number | null;
  readonly discNo: number | null;
  readonly year: number | null;
  readonly durationMs: number | null;
  readonly codec: string | null;
  readonly container: string | null;
  readonly lossless: boolean | null;
  readonly sampleRate: number | null;
  readonly bitDepth: number | null;
  readonly channels: number | null;
  readonly bitrate: number | null;
  readonly hasEmbeddedArt: boolean;
  /**
   * Where the track lies inside its file, for a track cut from a single-file
   * CD image by its CUE sheet; null when the track is the whole file.
   */
  readonly span: { readonly startMs: number; readonly endMs: number | null } | null;
  /** Dynamic range and highest sample (dBFS); null until analyzed, or silent. */
  readonly dr: number | null;
  readonly peakDb: number | null;
  readonly file: {
    /** For streaming: `/api/files/:id/audio`. */
    readonly id: number;
    /** `direct`: sent as stored, seekable. `transcode`: converted to FLAC while it plays. */
    readonly playback: 'direct' | 'transcode';
    /** Relative to the library root. Informational; the API never accepts paths. */
    readonly relPath: string;
    readonly size: number;
    readonly status: 'present' | 'missing' | 'error';
    readonly audioMd5: string | null;
  };
}

export interface TrackListItem extends TrackSummary {
  readonly album: {
    readonly id: number;
    readonly title: string;
    readonly artworkId: number | null;
  } | null;
}

export interface Disc {
  readonly discNo: number | null;
  readonly tracks: readonly TrackSummary[];
}

/** What a scanned image shows, in the order you would leaf through a case. */
export type ScanKind =
  | 'front'
  | 'booklet'
  | 'inside'
  | 'back'
  | 'tray'
  | 'disc'
  | 'obi'
  | 'extra'
  | 'spectrogram';

/** One scanned image from the album's folder (served via /api/artwork/:id). */
export interface AlbumScan {
  readonly artworkId: number;
  readonly kind: ScanKind;
  /** Page or item number from the file name ("Booklet 07" → 7). */
  readonly number: number | null;
  /** The file name without extension. */
  readonly label: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface AlbumDetail extends AlbumSummary {
  readonly musicbrainzAlbumId: string | null;
  readonly totalDiscs: number | null;
  readonly genres: readonly { readonly id: number; readonly name: string }[];
  readonly totalBytes: number;
  readonly discs: readonly Disc[];
  /** Scanned artwork in viewing order; empty when the folder has none. */
  readonly scans: readonly AlbumScan[];
  readonly ripLogs: readonly RipLogSummary[];
  /** Other pressings of the same album in the collection (same artist and title). */
  readonly otherPressings: readonly AlbumSummary[];
}

export interface ArtistSummary extends ArtistRef {
  readonly albumCount: number;
  readonly trackCount: number;
  /** Up to four covers, own albums first, for a mosaic. */
  readonly artworkIds: readonly number[];
}

export interface ArtistDetail extends ArtistRef {
  /** Albums where this is the album artist. */
  readonly albums: readonly AlbumSummary[];
  /** Other albums with tracks crediting this artist (compilations, guests). */
  readonly appearsOn: readonly AlbumSummary[];
  readonly trackCount: number;
}

export interface Facets {
  readonly genres: readonly {
    readonly id: number;
    readonly name: string;
    readonly albumCount: number;
  }[];
  readonly years: readonly { readonly year: number; readonly albumCount: number }[];
  readonly codecs: readonly { readonly codec: string; readonly trackCount: number }[];
  readonly sampleRates: readonly { readonly sampleRate: number; readonly trackCount: number }[];
  readonly bitDepths: readonly { readonly bitDepth: number; readonly trackCount: number }[];
}

export interface FormatBreakdown {
  readonly codec: string | null;
  readonly sampleRate: number | null;
  readonly bitDepth: number | null;
  readonly trackCount: number;
}

export interface Stats {
  readonly albums: number;
  readonly artists: number;
  readonly tracks: number;
  readonly durationMs: number;
  readonly totalBytes: number;
  readonly missingFiles: number;
  readonly errorFiles: number;
  readonly formats: readonly FormatBreakdown[];
}

export interface ScanRecord {
  readonly id: number;
  readonly status: 'running' | 'completed' | 'aborted' | 'failed';
  readonly mode: 'incremental' | 'full';
  readonly scopeSubpath: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly seen: number;
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly missing: number;
  readonly restored: number;
  readonly errors: number;
  readonly errorMessage: string | null;
}

export interface Health {
  readonly status: 'ok';
  readonly library: { readonly configured: boolean; readonly available: boolean };
  /** Whether formats browsers cannot play are converted (needs ffmpeg). */
  readonly transcoding: boolean;
  readonly lastScan: ScanRecord | null;
}

export interface SearchResults {
  readonly albums: readonly AlbumSummary[];
  readonly artists: readonly ArtistSummary[];
  readonly tracks: readonly TrackListItem[];
}

export interface ApiError {
  readonly error: {
    readonly code:
      | 'BAD_REQUEST'
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'METHOD_NOT_ALLOWED'
      | 'UNSUPPORTED_MEDIA_TYPE'
      | 'INVALID_FOLDER'
      | 'BUSY'
      | 'UNAVAILABLE'
      | 'INTERNAL';
    readonly message: string;
    readonly issues?: readonly { readonly path: string; readonly message: string }[];
  };
}

export interface HealthTrackRef {
  readonly trackId: number;
  readonly title: string | null;
  readonly displayArtist: string | null;
  readonly durationMs: number | null;
  readonly relPath: string;
  readonly album: { readonly id: number; readonly title: string } | null;
}

export interface ReportSection<T> {
  /** Total matching items; `items` may be capped. */
  readonly total: number;
  readonly items: readonly T[];
}

export interface AlbumIssues {
  readonly album: { readonly id: number; readonly title: string; readonly artist: string | null };
  /** Human-readable problems, e.g. "2 tracks without a title". */
  readonly issues: readonly string[];
}

export interface HealthReport {
  readonly missingFiles: ReportSection<{
    readonly relPath: string;
    readonly missingSince: string | null;
    readonly track: HealthTrackRef | null;
  }>;
  readonly unreadableFiles: ReportSection<{
    readonly relPath: string;
    readonly error: string | null;
  }>;
  readonly missingArtwork: ReportSection<{
    readonly id: number;
    readonly title: string;
    readonly artist: string | null;
  }>;
  readonly metadataIssues: ReportSection<AlbumIssues>;
  /** Files whose decoded audio is bit-identical (same audio MD5). */
  readonly exactDuplicates: ReportSection<{
    readonly audioMd5: string;
    readonly tracks: readonly HealthTrackRef[];
  }>;
  /** Same artist and title, durations within two seconds. */
  readonly probableDuplicates: ReportSection<{ readonly tracks: readonly HealthTrackRef[] }>;
  /** One album key whose tracks live in unrelated folders. */
  readonly splitAlbums: ReportSection<{
    readonly album: { readonly id: number; readonly title: string; readonly artist: string | null };
    readonly folders: readonly string[];
  }>;
  /** Albums whose rip logs report problems or disagree with AccurateRip. */
  readonly ripChecks: ReportSection<{
    readonly album: { readonly id: number; readonly title: string; readonly artist: string | null };
    readonly verdict: RipVerdict;
    /** One line per log that says something is off. */
    readonly notes: readonly string[];
  }>;
}

/** Collection statistics for the ledger. Counts are of releases (see ALBUM_KINDS). */
export interface Statistics {
  readonly releases: number;
  readonly decades: readonly { readonly decade: number; readonly releases: number }[];
  /** Releases without a year. */
  readonly undated: number;
  /** Countries named in pressing details ("1991 Japan …", "[1st UK]"), most first. */
  readonly origins: readonly { readonly country: string; readonly releases: number }[];
  readonly genres: readonly {
    readonly id: number;
    readonly name: string;
    readonly releases: number;
  }[];
  readonly artists: readonly {
    readonly id: number;
    readonly name: string;
    readonly releases: number;
  }[];
  /** Mean dynamic range of the measured releases of each decade (album year). */
  readonly dynamicsByDecade: readonly {
    readonly decade: number;
    readonly dr: number;
    readonly releases: number;
  }[];
  /** Releases per rip verdict; `none` means no rip log. */
  readonly rips: readonly { readonly verdict: RipVerdict | 'none'; readonly releases: number }[];
}

/** The music folder and what the app is doing with it. */
export interface LibraryStatus {
  /** The music folder, or null before one is chosen. */
  readonly root: string | null;
  /** `env`: set by SONIC_LIBRARY_ROOT, so the app cannot change it. */
  readonly source: 'env' | 'file' | null;
  /** Following changes in the folder while the app runs. */
  readonly watching: boolean;
  readonly state: 'unconfigured' | 'idle' | 'scanning' | 'analyzing';
  /** While scanning: files seen; while analyzing: files measured of total. */
  readonly progress: { readonly done: number; readonly total: number | null } | null;
  /** The last problem (an unreachable folder, a failed scan), if any. */
  readonly error: string | null;
}

/** One folder's subfolders, for choosing the music folder. Names only; no files. */
export interface FolderListing {
  readonly path: string;
  readonly parent: string | null;
  readonly folders: readonly { readonly name: string; readonly path: string }[];
  /** Likely places for music: the home folder, ~/Music, mounted drives. */
  readonly places: readonly { readonly name: string; readonly path: string }[];
}

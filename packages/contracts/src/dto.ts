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
  readonly file: {
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

export interface AlbumDetail extends AlbumSummary {
  readonly musicbrainzAlbumId: string | null;
  readonly totalDiscs: number | null;
  readonly genres: readonly { readonly id: number; readonly name: string }[];
  readonly totalBytes: number;
  readonly discs: readonly Disc[];
}

export interface ArtistSummary extends ArtistRef {
  readonly albumCount: number;
  readonly trackCount: number;
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
  readonly lastScan: ScanRecord | null;
}

export interface SearchResults {
  readonly albums: readonly AlbumSummary[];
  readonly artists: readonly ArtistSummary[];
  readonly tracks: readonly TrackListItem[];
}

export interface ApiError {
  readonly error: {
    readonly code: 'BAD_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN' | 'METHOD_NOT_ALLOWED' | 'INTERNAL';
    readonly message: string;
    readonly issues?: readonly { readonly path: string; readonly message: string }[];
  };
}

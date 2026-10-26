/**
 * Typed client for the read-only API. Response types come from
 * @sonic-archive/contracts, the same definitions the server produces.
 */
import type {
  AlbumDetail,
  AlbumSummary,
  ApiError,
  ArtistDetail,
  ArtistSummary,
  Facets,
  Health,
  HealthReport,
  Page,
  RipLogText,
  ScanRecord,
  SearchResults,
  Stats,
  TrackListItem,
} from '@sonic-archive/contracts';

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

export type Params = Record<string, string | number | boolean | null | undefined>;

/** Builds `/api/<path>?…`, dropping empty values so URLs stay canonical. */
export function apiUrl(path: string, params: Params = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return `/api/${path}${query ? `?${query}` : ''}`;
}

async function get<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path, params), {
    headers: { Accept: 'application/json' },
    ...(signal && { signal }),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      message = ((await response.json()) as ApiError).error.message;
    } catch {
      // Not JSON (e.g. the API is not running and a proxy answered).
    }
    throw new ApiRequestError(response.status, message);
  }
  return (await response.json()) as T;
}

/**
 * `sm` (400 px) for grids and lists, `lg` (1200 px) for the album page,
 * `xl` (2000 px) for reading booklet scans.
 */
export function artworkUrl(id: number, size: 'sm' | 'lg' | 'xl' = 'sm'): string {
  return `/api/artwork/${id}?size=${size}`;
}

export const api = {
  health: (signal?: AbortSignal) => get<Health>('health', undefined, signal),
  stats: (signal?: AbortSignal) => get<Stats>('stats', undefined, signal),
  facets: (signal?: AbortSignal) => get<Facets>('facets', undefined, signal),
  albums: (params: Params, signal?: AbortSignal) =>
    get<Page<AlbumSummary>>('albums', params, signal),
  album: (id: number, signal?: AbortSignal) => get<AlbumDetail>(`albums/${id}`, undefined, signal),
  tracks: (params: Params, signal?: AbortSignal) =>
    get<Page<TrackListItem>>('tracks', params, signal),
  artists: (params: Params, signal?: AbortSignal) =>
    get<Page<ArtistSummary>>('artists', params, signal),
  artist: (id: number, signal?: AbortSignal) =>
    get<ArtistDetail>(`artists/${id}`, undefined, signal),
  search: (q: string, signal?: AbortSignal) => get<SearchResults>('search', { q }, signal),
  scans: (signal?: AbortSignal) => get<ScanRecord[]>('scans', { limit: 20 }, signal),
  healthReport: (signal?: AbortSignal) => get<HealthReport>('health-report', undefined, signal),
  ripLog: (id: number, signal?: AbortSignal) =>
    get<RipLogText>(`rip-logs/${id}`, undefined, signal),
};

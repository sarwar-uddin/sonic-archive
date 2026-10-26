/**
 * Typed client for the API. Response types come from @sonic-archive/contracts,
 * the same definitions the server produces. Almost everything is a read;
 * the few changes (choosing the music folder, rescans, settings) go through
 * `send`, which adds the session token the server requires.
 */
import type {
  AlbumDetail,
  AlbumSummary,
  ApiError,
  ArtistDetail,
  ArtistSummary,
  Facets,
  FolderListing,
  Health,
  HealthReport,
  LibraryStatus,
  Page,
  RipLogText,
  ScanRecord,
  SearchResults,
  Statistics,
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
  return readJson<T>(response);
}

let token: Promise<string> | null = null;
const sessionToken = () => {
  token ??= get<{ token: string }>('session').then((s) => s.token);
  return token;
};

/**
 * A change request: JSON, with the session token. If the server restarted
 * (new token), the token is fetched again and the request retried once.
 */
async function send<T>(
  method: 'PUT' | 'POST',
  path: string,
  body: unknown,
  retry = true,
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Sonic-Token': await sessionToken(),
    },
    body: JSON.stringify(body),
  });
  if (response.status === 403 && retry) {
    token = null;
    return send<T>(method, path, body, false);
  }
  return readJson<T>(response);
}

async function readJson<T>(response: Response): Promise<T> {
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
  statistics: (signal?: AbortSignal) => get<Statistics>('statistics', undefined, signal),
  library: (signal?: AbortSignal) => get<LibraryStatus>('library', undefined, signal),
  folders: (path: string | undefined, signal?: AbortSignal) =>
    get<FolderListing>('folders', { path }, signal),
  chooseFolder: (path: string) => send<LibraryStatus>('PUT', 'library', { path }),
  rescan: (full: boolean) => send<LibraryStatus>('POST', 'library/scan', { full }),
  setWatching: (watch: boolean) => send<LibraryStatus>('PUT', 'library/settings', { watch }),
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

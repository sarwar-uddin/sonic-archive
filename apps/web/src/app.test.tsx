import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupByInitial } from './pages/ArtistsPage.tsx';
import { albumDetail, albumSummary, stats } from './test/fixtures.ts';
import { LIBRARY_READY, mockApi, renderApp } from './test/render.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const facets = {
  genres: [{ id: 3, name: 'Chamber', albumCount: 1 }],
  years: [{ year: 2020, albumCount: 1 }],
  codecs: [{ codec: 'FLAC', trackCount: 2 }],
  sampleRates: [],
  bitDepths: [],
};
const page = (items: unknown[]) => ({ items, page: 1, limit: 48, total: items.length });

describe('album page', () => {
  it('lists discs and tracks in order with their resolutions', async () => {
    mockApi({ 'albums/7': albumDetail, stats });
    renderApp('/albums/7');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hi-Res Session' }),
    ).toBeInTheDocument();
    const discs = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(discs).toEqual(['Disc 1', 'Disc 2']);

    const disc1 = within(screen.getByRole('region', { name: 'Disc 1' }));
    const rows = disc1.getAllByRole('button', { expanded: false });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Overture24\/964:05$/),
      expect.stringMatching(/^InterludeGuest Cellist24\/964:05$/),
    ]);
    // The number sits on each row's play button.
    expect(disc1.getByRole('button', { name: 'Play Overture' })).toHaveTextContent('1');
    // Row 1 omits its artist (same as the album artist); row 2 shows its guest.
  });

  it('plays the album, or from a chosen track, in the player bar', async () => {
    mockApi({ 'albums/7': albumDetail, stats });
    renderApp('/albums/7');
    await userEvent.click(await screen.findByRole('button', { name: 'Play album' }));
    const bar = within(screen.getByRole('region', { name: 'Player' }));
    expect(bar.getByText('Overture')).toBeInTheDocument();
    // Coda's file is missing, so it is left out of the queue.
    expect(bar.getByText('1 / 2')).toBeInTheDocument();
    expect(bar.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    // The album's own button follows the player.
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Play Interlude' }));
    expect(bar.getByText('Interlude')).toBeInTheDocument();
    expect(bar.getByText('2 / 2')).toBeInTheDocument();
    expect(bar.getByRole('button', { name: 'Next track' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Play Coda' })).not.toBeInTheDocument();
  });

  it('shows a spec sheet with full and compact resolution', async () => {
    mockApi({ 'albums/7': albumDetail, stats });
    renderApp('/albums/7');
    const sheet = within(await screen.findByRole('complementary', { name: 'Specification' }));
    expect(sheet.getByText('24 bit / 96 kHz')).toBeInTheDocument();
    expect(sheet.getByText('3 tracks on 2 discs')).toBeInTheDocument();
    expect(sheet.getByText('114 MB')).toBeInTheDocument();
  });

  it('expands a track to show its technical details', async () => {
    mockApi({ 'albums/7': albumDetail, stats });
    renderApp('/albums/7');
    const coda = await screen.findByRole('button', { name: /Coda/ });
    expect(within(coda).getByText('Missing')).toBeInTheDocument();
    expect(screen.queryByText('Basalt/CD2/01 Coda.m4a')).not.toBeVisible();

    await userEvent.click(coda);
    expect(coda).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Basalt/CD2/01 Coda.m4a')).toBeVisible();
    expect(screen.getByText('ALAC · 16 bit / 44.1 kHz · Stereo')).toBeVisible();
  });

  it('renders a placeholder sleeve when there is no artwork', async () => {
    mockApi({ 'albums/7': albumDetail, stats });
    renderApp('/albums/7');
    expect(
      await screen.findByRole('img', { name: 'No cover for Hi-Res Session by Basalt Quartet' }),
    ).toBeInTheDocument();
  });

  it('opens scanned artwork in a viewer and pages with the arrow keys', async () => {
    const scan = (artworkId: number, kind: string, number: number | null, label: string) => ({
      artworkId,
      kind,
      number,
      label,
      width: 1000,
      height: 1000,
    });
    mockApi({
      'albums/7': {
        ...albumDetail,
        scans: [
          scan(11, 'front', null, 'front'),
          scan(12, 'booklet', 1, 'Booklet 01'),
          scan(13, 'booklet', 2, 'Booklet 02'),
          scan(14, 'disc', null, 'CD'),
        ],
      },
      stats,
    });
    renderApp('/albums/7');
    const shelf = within(await screen.findByRole('region', { name: 'Sleeve & booklet' }));
    expect(shelf.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Front',
      'Booklet 2',
      'Disc',
    ]);

    await userEvent.click(shelf.getByRole('button', { name: 'View Booklet · page 1 of 2' }));
    const viewer = within(screen.getByRole('dialog', { name: 'Hi-Res Session: scanned artwork' }));
    expect(viewer.getByRole('img', { name: 'Booklet · page 1 of 2' })).toHaveAttribute(
      'src',
      '/api/artwork/12?size=xl',
    );
    expect(viewer.getByText('2 / 4')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(viewer.getByRole('img', { name: 'Booklet · page 2 of 2' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(viewer.getByRole('img', { name: 'Disc' })).toBeInTheDocument();
    expect(viewer.getByRole('button', { name: 'Next scan' })).toBeDisabled();

    await userEvent.click(viewer.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('summarizes the rip logs and opens one in full', async () => {
    const log = {
      id: 31,
      label: 'Hi-Res Session.log',
      disc: null,
      tool: 'EAC',
      toolVersion: 'V1.8',
      drive: 'TEST DRIVE',
      readMode: 'Secure',
      secureMode: true,
      readOffset: 6,
      crcChecks: 1,
      crcMismatches: 0,
      readProblems: 0,
      accurateRip: { accurate: 3, inaccurate: 0, notInDatabase: 0, minConfidence: 12 },
      ctdb: null,
      hasChecksum: true,
      verdict: 'verified',
    };
    mockApi({
      'albums/7': { ...albumDetail, rip: 'verified', ripLogs: [log] },
      'rip-logs/31': {
        id: 31,
        albumId: 7,
        label: log.label,
        text: 'Exact Audio Copy V1.8\nAll tracks accurately ripped',
      },
      stats,
    });
    renderApp('/albums/7');
    const sheet = within(await screen.findByRole('complementary', { name: 'Specification' }));
    expect(sheet.getAllByText('Verified')).toHaveLength(2); // album and log
    expect(sheet.getByText('AccurateRip 3/3 accurate (confidence ≥ 12)')).toBeInTheDocument();
    expect(sheet.getByText('Test & copy CRCs match')).toBeInTheDocument();
    expect(sheet.getByText('Offset +6')).toBeInTheDocument();

    await userEvent.click(sheet.getByRole('button', { name: 'Read log' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Hi-Res Session.log' }));
    expect(await dialog.findByText(/All tracks accurately ripped/)).toBeInTheDocument();
  });

  it('compares the pressings of an album in the collection', async () => {
    const japan = {
      ...albumSummary,
      id: 8,
      year: 1986,
      edition: ['1986 Japan 32DP 448'],
      rip: 'verified' as const,
      pressings: 2,
    };
    mockApi({
      'albums/7': { ...albumDetail, pressings: 2, otherPressings: [japan] },
      stats,
    });
    renderApp('/albums/7');
    const section = within(
      await screen.findByRole('region', { name: 'Pressings in your collection' }),
    );
    const rows = section.getAllByRole('row').slice(1);
    // Oldest first; this copy is marked and not linked.
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true']);
    expect(section.getByRole('link', { name: '1986 Japan 32DP 448' })).toHaveAttribute(
      'href',
      '/albums/8',
    );
    expect(within(rows[0] as HTMLElement).getByText('Verified')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('This copy')).toBeInTheDocument();
  });

  it('leaves out the scan section when the folder has none', async () => {
    mockApi({ 'albums/7': albumDetail, stats });
    renderApp('/albums/7');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Sleeve & booklet' })).not.toBeInTheDocument();
  });

  it('shows not-found for an unknown album', async () => {
    mockApi({ stats });
    renderApp('/albums/999');
    expect(await screen.findByText(/Not in the/)).toBeInTheDocument();
  });
});

describe('library page', () => {
  it('shows albums with their spec tag', async () => {
    mockApi({ albums: page([albumSummary]), facets, stats });
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Hi-Res Session' })).toHaveAttribute(
      'href',
      '/albums/7',
    );
    expect(screen.getByText('FLAC 24/96')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Releases');
    // Once in the page count, once on the artist divider (sorted by artist).
    expect(screen.getAllByText('1 release')).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 2, name: 'Basalt Quartet' })).toBeInTheDocument();
    // Pressing details from the folder name appear on the card.
    expect(screen.getByText('1st Japan · SICP-1234')).toBeInTheDocument();
  });

  it('stands albums on a shelf as spines', async () => {
    const japan = {
      ...albumSummary,
      id: 9,
      title: 'Paranoid',
      albumArtist: { id: 3, name: 'Black Sabbath' },
      year: 1970,
      edition: ['1991 Japan TECP-23893 Teichiku'],
      obi: true,
    };
    mockApi({ albums: page([albumSummary, japan]), facets, stats });
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Shelf' }));
    expect(router.state.location.search).toBe('?view=shelf');
    const shelf = within(screen.getByRole('list', { name: 'Albums on the shelf' }));
    const spine = shelf.getByRole('link', { name: 'Black Sabbath · Paranoid · 1970' });
    expect(spine).toHaveAttribute('href', '/albums/9');
    expect(within(spine).getByText('TECP-23893')).toBeInTheDocument();
    expect(shelf.getByRole('link', { name: /Hi-Res Session/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Covers' }));
    expect(router.state.location.search).toBe('');
  });

  it('notes albums held in more than one pressing', async () => {
    mockApi({ albums: page([{ ...albumSummary, pressings: 2 }]), facets, stats });
    renderApp('/');
    expect(await screen.findByText('2 pressings in the collection')).toBeInTheDocument();
  });

  it('marks albums whose rip is verified', async () => {
    mockApi({ albums: page([{ ...albumSummary, rip: 'verified' }]), facets, stats });
    renderApp('/');
    expect(await screen.findByTitle('Rip verified by AccurateRip or CTDB')).toHaveTextContent(
      'AR ✓',
    );
  });

  it('turns filter choices into URL state and API parameters', async () => {
    const fetchMock = mockApi({ albums: page([albumSummary]), facets, stats });
    const { router } = renderApp('/');
    await screen.findByRole('link', { name: 'Hi-Res Session' });

    await userEvent.selectOptions(screen.getByLabelText('Resolution'), '24bit');
    await userEvent.selectOptions(screen.getByLabelText('Decade'), '2020');

    expect(router.state.location.search).toBe('?res=24bit&decade=2020');
    await waitFor(() => {
      const last = String(
        fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/albums')).at(-1)?.[0],
      );
      expect(last).toContain('minBitDepth=24');
      expect(last).toContain('yearFrom=2020');
      expect(last).toContain('yearTo=2029');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.state.location.search).toBe('');
  });

  it('says the first scan is running, or that the folder holds no music', async () => {
    mockApi({
      albums: page([]),
      facets,
      stats: { ...stats, albums: 0, tracks: 0 },
      library: { ...LIBRARY_READY, state: 'scanning', progress: { done: 12, total: null } },
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Reading your music…' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Library progress' })).toHaveTextContent(
      'Scanning your music… 12 files',
    );
  });
});

describe('choosing the music folder', () => {
  const NO_FOLDER = { ...LIBRARY_READY, root: null, source: null, state: 'unconfigured' };
  const listing = (path: string) => ({
    path,
    parent: path === '/home/you' ? '/home' : '/home/you',
    folders:
      path === '/home/you'
        ? [
            { name: 'Documents', path: '/home/you/Documents' },
            { name: 'Music', path: '/home/you/Music' },
          ]
        : [],
    places: [{ name: 'Home', path: '/home/you' }],
  });

  it('asks for a folder on first run, then opens the collection', async () => {
    let chosen: unknown = null;
    let token: string | null = null;
    mockApi({
      stats,
      albums: page([albumSummary]),
      facets,
      library: () => (chosen ? { ...LIBRARY_READY, root: '/home/you/Music' } : NO_FOLDER),
      session: { token: 'abc' },
      folders: (url: URL) => listing(url.searchParams.get('path') ?? '/home/you'),
      'PUT library': (_url: URL, init?: RequestInit) => {
        chosen = JSON.parse(String(init?.body));
        token = new Headers(init?.headers).get('X-Sonic-Token');
        return { ...LIBRARY_READY, root: '/home/you/Music' };
      },
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: /Where is your/ })).toBeInTheDocument();
    const folders = within(await screen.findByRole('list', { name: 'Folders' }));
    await userEvent.click(folders.getByRole('button', { name: /Music/ }));
    expect(await screen.findByText('/home/you/Music')).toBeInTheDocument();
    expect(await screen.findByText('No folders inside.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
    await waitFor(() => expect(chosen).toEqual({ path: '/home/you/Music' }));
    expect(token).toBe('abc');
    expect(await screen.findByRole('heading', { level: 1, name: /Releases/ })).toBeInTheDocument();
  });

  it('explains why a folder was refused', async () => {
    mockApi({
      library: NO_FOLDER,
      session: { token: 'abc' },
      folders: (url: URL) => listing(url.searchParams.get('path') ?? '/home/you'),
      'PUT library': () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'INVALID_FOLDER',
              message: 'Library root /home/you is the home directory or contains it.',
            },
          }),
          { status: 400 },
        ),
    });
    renderApp('/');
    await screen.findByRole('list', { name: 'Folders' });
    await userEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('is the home directory');
  });

  it('settings: watch toggle and rescans send their requests', async () => {
    const sent: string[] = [];
    mockApi({
      stats,
      session: { token: 'abc' },
      'PUT library/settings': (_url: URL, init?: RequestInit) => {
        sent.push(`settings ${init?.body}`);
        return { ...LIBRARY_READY, watching: false };
      },
      'POST library/scan': (_url: URL, init?: RequestInit) => {
        sent.push(`scan ${init?.body}`);
        return { ...LIBRARY_READY, state: 'scanning', progress: { done: 0, total: null } };
      },
    });
    renderApp('/settings');
    expect(await screen.findByText('/music')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Watch the folder/ }));
    await waitFor(() => expect(sent).toContain('settings {"watch":false}'));
    expect(screen.getByRole('checkbox', { name: /Watch the folder/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Re-read every file' }));
    await waitFor(() => expect(sent).toContain('scan {"full":true}'));
  });
});

describe('search', () => {
  it('submits from the masthead and shows grouped results', async () => {
    mockApi({
      stats,
      albums: page([albumSummary]),
      facets,
      search: (url: URL) => ({
        albums: url.searchParams.get('q') === 'basalt' ? [albumSummary] : [],
        artists: [{ id: 1, name: 'Basalt Quartet', albumCount: 1, trackCount: 3, artworkIds: [] }],
        tracks: [],
      }),
    });
    const { router } = renderApp('/');
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search the collection' }),
      'basalt{Enter}',
    );
    expect(router.state.location.pathname).toBe('/search');
    expect(await screen.findByRole('heading', { name: /Artists/ })).toBeInTheDocument();
    const artists = within(screen.getByRole('region', { name: /Artists/ }));
    expect(artists.getByRole('link', { name: 'Basalt Quartet' })).toHaveAttribute(
      'href',
      '/artists/1',
    );
    expect(screen.getByRole('region', { name: /Albums/ })).toHaveTextContent('Hi-Res Session');
  });
});

describe('live library', () => {
  it('refreshes and says so when a scan finishes with changes', async () => {
    const sources: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      readonly url: string;
      constructor(url: string) {
        super();
        this.url = url;
        sources.push(this);
      }
      close() {}
      emit(scan: object | null) {
        this.dispatchEvent(new MessageEvent('scan', { data: JSON.stringify(scan) }));
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetchMock = mockApi({ stats, albums: page([albumSummary]), facets });
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    const source = sources[0];
    if (!source) throw new Error('no event source');
    expect(source.url).toBe('/api/events');

    const scan = { id: 4, added: 0, updated: 0, restored: 0, missing: 0 };
    act(() => source.emit(scan)); // the scan the page loaded after: nothing to say
    expect(screen.getByRole('status', { name: 'Library updates' })).toHaveTextContent('');
    const statsCalls = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/stats')).length;
    const before = statsCalls();
    act(() => source.emit({ ...scan, id: 5, added: 2, updated: 1 }));
    expect(screen.getByRole('status', { name: 'Library updates' })).toHaveTextContent(
      'Library updated: 2 added, 1 updated',
    );
    await waitFor(() => expect(statsCalls()).toBeGreaterThan(before));
  });
  it('treats the first scan of a new install as news', async () => {
    const sources: { emit: (scan: object | null) => void }[] = [];
    vi.stubGlobal(
      'EventSource',
      class extends EventTarget {
        constructor() {
          super();
          sources.push(this as unknown as { emit: (scan: object | null) => void });
        }
        close() {}
        emit(scan: object | null) {
          this.dispatchEvent(new MessageEvent('scan', { data: JSON.stringify(scan) }));
        }
      },
    );
    mockApi({ stats, albums: page([albumSummary]), facets });
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    act(() => sources[0]?.emit(null));
    act(() => sources[0]?.emit({ id: 1, added: 18, updated: 0, restored: 0, missing: 0 }));
    expect(screen.getByRole('status', { name: 'Library updates' })).toHaveTextContent(
      'Library updated: 18 added',
    );
  });
});

describe('search palette', () => {
  const searchApi = (url: URL) => ({
    albums: url.searchParams.get('q') === 'basalt' ? [albumSummary] : [],
    artists: [{ id: 1, name: 'Basalt Quartet', albumCount: 1, trackCount: 3, artworkIds: [] }],
    tracks: [],
  });

  it('opens with "/", searches as you type, and jumps with the keyboard', async () => {
    mockApi({
      stats,
      albums: page([albumSummary]),
      facets,
      search: searchApi,
      'albums/7': albumDetail,
    });
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1 });

    await userEvent.keyboard('/');
    const palette = within(screen.getByRole('dialog', { name: 'Search and jump' }));
    const input = palette.getByRole('combobox');
    expect(input).toHaveFocus();
    // Before typing: the pages.
    expect(palette.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'CollectionPage',
      'ArtistsPage',
      'TracksPage',
      'HealthPage',
      'LedgerPage',
    ]);

    await userEvent.type(input, 'basalt');
    expect(await palette.findByRole('option', { name: /Hi-Res Session/ })).toBeInTheDocument();
    expect(palette.getByRole('option', { name: /^Basalt Quartet1 album/ })).toBeInTheDocument();
    expect(
      palette.getByRole('option', { name: /See all results for “basalt”/ }),
    ).toBeInTheDocument();

    // The first option is highlighted; Enter opens it.
    expect(palette.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/albums/7');
    expect(screen.queryByRole('dialog', { name: 'Search and jump' })).not.toBeInTheDocument();
  });

  it('opens with Ctrl-K even from a text field, but "/" there just types', async () => {
    mockApi({ stats, albums: page([albumSummary]), facets, search: searchApi });
    renderApp('/');
    const box = await screen.findByRole('searchbox', { name: 'Search the collection' });
    await userEvent.type(box, 'a/b');
    expect(box).toHaveValue('a/b');
    expect(screen.queryByRole('dialog', { name: 'Search and jump' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Control>}k{/Control}');
    const palette = within(screen.getByRole('dialog', { name: 'Search and jump' }));
    await userEvent.type(palette.getByRole('combobox'), 'led');
    await userEvent.keyboard('{ArrowDown}{ArrowUp}');
    expect(palette.getByRole('option', { name: /Ledger/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('groupByInitial', () => {
  it('folds accents, keeps other scripts, and puts symbols last', () => {
    const names = ['Ísold', 'iron maiden', 'Дискография', '2Pac', 'Àbba', 'Opeth'];
    const groups = groupByInitial(
      names.map((name, id) => ({ id, name, albumCount: 1, trackCount: 1, artworkIds: [] })),
    );
    expect(groups.map(([letter, list]) => [letter, list.map((a) => a.name)])).toEqual([
      ['A', ['Àbba']],
      ['I', ['Ísold', 'iron maiden']],
      ['O', ['Opeth']],
      ['Д', ['Дискография']],
      ['#', ['2Pac']],
    ]);
  });
});

describe('ledger charts', () => {
  it('draws decades, origins, genres, artists and rip verdicts', async () => {
    mockApi({
      stats,
      health: { status: 'ok', library: { configured: true, available: true }, lastScan: null },
      scans: [],
      statistics: {
        releases: 10,
        decades: [
          { decade: 1970, releases: 3 },
          { decade: 1980, releases: 7 },
        ],
        undated: 1,
        origins: [{ country: 'Japan', releases: 4 }],
        genres: [{ id: 5, name: 'Rock', releases: 6 }],
        artists: [{ id: 2, name: 'Pink Floyd', releases: 5 }],
        dynamicsByDecade: [
          { decade: 1970, dr: 13.5, releases: 3 },
          { decade: 1980, dr: 9.25, releases: 7 },
        ],
        rips: [
          { verdict: 'verified', releases: 6 },
          { verdict: 'none', releases: 4 },
        ],
      },
    });
    renderApp('/ledger');
    const decades = within(await screen.findByRole('list', { name: 'Releases by decade' }));
    expect(decades.getByRole('img', { name: '1980s: 7 releases' })).toBeInTheDocument();
    expect(screen.getByText('1 without a year are left out', { exact: false })).toBeInTheDocument();
    // The table view lists every value.
    expect(screen.getAllByText('Show as a table')).toHaveLength(2);

    const dynamics = within(screen.getByRole('list', { name: 'Mean dynamic range by decade' }));
    expect(dynamics.getByRole('img', { name: '1980s: DR 9.3' })).toBeInTheDocument();

    const origins = within(screen.getByRole('list', { name: 'Releases by country of pressing' }));
    expect(origins.getByText('Japan')).toBeInTheDocument();
    expect(origins.getByText('40%', { exact: false })).toBeInTheDocument();

    const genres = within(screen.getByRole('list', { name: 'Releases by genre' }));
    expect(genres.getByRole('link', { name: 'Rock: 6 releases' })).toHaveAttribute(
      'href',
      '/?genre=5',
    );

    const rips = within(screen.getByRole('figure', { name: 'Releases by rip verdict' }));
    expect(rips.getByRole('img', { name: 'Verified: 6 releases' })).toBeInTheDocument();
    expect(rips.getByText('No rip log')).toBeInTheDocument();
    expect(rips.getByText('4 · 40%')).toBeInTheDocument();
  });
});

describe('health page', () => {
  it('summarizes problems and lists duplicate groups', async () => {
    const empty = { total: 0, items: [] };
    const track = (trackId: number, title: string, relPath: string) => ({
      trackId,
      title,
      displayArtist: 'Aurora Field',
      durationMs: 500,
      relPath,
      album: { id: 1, title: 'Northern Lines' },
    });
    mockApi({
      stats,
      'health-report': {
        missingFiles: empty,
        unreadableFiles: {
          total: 1,
          items: [{ relPath: 'Broken/garbage.flac', error: 'Invalid FLAC preamble' }],
        },
        missingArtwork: empty,
        metadataIssues: {
          total: 1,
          items: [{ album: { id: 9, title: 'Untagged', artist: null }, issues: ['No year'] }],
        },
        exactDuplicates: {
          total: 1,
          items: [
            {
              audioMd5: 'f92951abe8308de3f54a91cda07e7faa',
              tracks: [
                track(1, 'First Light', 'A/01.flac'),
                track(2, 'First Light (copy)', 'Dup/01.flac'),
              ],
            },
          ],
        },
        probableDuplicates: empty,
        splitAlbums: empty,
        ripChecks: {
          total: 1,
          items: [
            {
              album: { id: 4, title: 'OK Computer', artist: 'Radiohead' },
              verdict: 'differs',
              notes: ['OK Computer.log: 12 of 12 tracks differ from AccurateRip'],
            },
          ],
        },
      },
    });
    renderApp('/health');

    const summary = within(await screen.findByRole('navigation', { name: 'Report sections' }));
    expect(summary.getByRole('link', { name: /1\s*Exact duplicates/ })).toHaveAttribute(
      'href',
      '#exact',
    );
    expect(summary.getByRole('link', { name: /0\s*Missing files/ })).toBeInTheDocument();

    const exact = within(screen.getByRole('region', { name: /Exact duplicates/ }));
    expect(exact.getByText('f92951abe8308de3f54a91cda07e7faa')).toBeInTheDocument();
    expect(exact.getByRole('link', { name: 'First Light (copy)' })).toHaveAttribute(
      'href',
      '/albums/1',
    );
    expect(screen.getByText('Every catalogued file is where it was.')).toBeInTheDocument();
    expect(screen.getByText('Invalid FLAC preamble')).toBeInTheDocument();

    const rips = within(screen.getByRole('region', { name: /Rip checks/ }));
    expect(rips.getByRole('link', { name: 'OK Computer' })).toHaveAttribute('href', '/albums/4');
    expect(rips.getByText('Differs from AccurateRip')).toBeInTheDocument();
    expect(rips.getByText(/12 of 12 tracks differ/)).toBeInTheDocument();
  });
});

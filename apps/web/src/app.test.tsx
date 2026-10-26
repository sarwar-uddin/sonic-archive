import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupByInitial } from './pages/ArtistsPage.tsx';
import { albumDetail, albumSummary, stats } from './test/fixtures.ts';
import { mockApi, renderApp } from './test/render.tsx';

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
      expect.stringMatching(/^1Overture24\/964:05$/),
      expect.stringMatching(/^2InterludeGuest Cellist24\/964:05$/),
    ]);
    // Row 1 omits its artist (same as the album artist); row 2 shows its guest.
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

  it('explains how to get started when nothing is catalogued', async () => {
    mockApi({
      albums: page([]),
      facets,
      stats: { ...stats, albums: 0, tracks: 0 },
      health: { status: 'ok', library: { configured: false, available: false }, lastScan: null },
    });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Nothing catalogued yet.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pnpm scan --confirm --subpath/)).toBeInTheDocument();
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

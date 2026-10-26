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
    const sheet = within(await screen.findByRole('region', { name: 'Specification' }));
    expect(sheet.getByText('24 bit / 96 kHz')).toBeInTheDocument();
    expect(sheet.getByText('24/96')).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('1 album');
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
        artists: [{ id: 1, name: 'Basalt Quartet', albumCount: 1, trackCount: 3 }],
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
      names.map((name, id) => ({ id, name, albumCount: 1, trackCount: 1 })),
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
  });
});

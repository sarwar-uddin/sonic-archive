import { describe, expect, it } from 'vitest';
import {
  albumMetadataIssues,
  numberingProblems,
  probableDuplicates,
  splitAlbumFolders,
  type TrackFacts,
} from './health-rules.ts';

let nextId = 1;
function t(overrides: Partial<TrackFacts> = {}): TrackFacts {
  const trackId = nextId++;
  return {
    trackId,
    albumId: 1,
    groupKey: 'tag:a|b',
    title: `Song ${trackId}`,
    displayArtist: 'Artist',
    creditCount: 1,
    trackNo: trackId,
    discNo: null,
    year: 2000,
    durationMs: 200_000,
    relPath: `Artist/Album/${trackId}.flac`,
    ...overrides,
  };
}

describe('albumMetadataIssues', () => {
  it('reports nothing for a clean album', () => {
    expect(albumMetadataIssues([t({ trackNo: 1 }), t({ trackNo: 2 })])).toEqual(new Map());
  });

  it('describes each kind of problem', () => {
    const issues = albumMetadataIssues([
      t({
        groupKey: 'dir:Untagged',
        title: null,
        displayArtist: null,
        creditCount: 0,
        trackNo: null,
        year: null,
      }),
      t({ groupKey: 'dir:Untagged', trackNo: 2, year: null }),
    ]);
    expect(issues.get(1)).toEqual([
      'No album tag: grouped by folder',
      '1 track without a title',
      '1 track without an artist',
      '1 track without a track number',
      'No year',
      'Missing track 1',
    ]);
  });

  it('keeps albums separate', () => {
    const issues = albumMetadataIssues([
      t({ albumId: 1, title: null }),
      t({ albumId: 2, trackNo: 1 }),
    ]);
    expect([...issues.keys()]).toEqual([1]);
  });
});

describe('numberingProblems', () => {
  it('finds gaps and repeats per disc', () => {
    const tracks = [
      t({ discNo: 1, trackNo: 1 }),
      t({ discNo: 1, trackNo: 3 }),
      t({ discNo: 2, trackNo: 1 }),
      t({ discNo: 2, trackNo: 1 }),
    ];
    expect(numberingProblems(tracks)).toEqual([
      'Missing track 2 on disc 1',
      'Repeated track number 1 on disc 2',
    ]);
  });

  it('abbreviates long gaps', () => {
    expect(numberingProblems([t({ trackNo: 20 })])).toEqual(['Missing track 1, 2, 3, 4, 5, 6, …']);
  });
});

describe('probableDuplicates', () => {
  it('groups same artist and title within the tolerance, ignoring case and accents', () => {
    const a = t({ title: 'Ágætis byrjun', displayArtist: 'Sigur Rós', durationMs: 600_000 });
    const b = t({ title: 'ágætis BYRJUN', displayArtist: 'sigur ros', durationMs: 601_500 });
    const c = t({ title: 'Ágætis byrjun', displayArtist: 'Sigur Rós', durationMs: 640_000 });
    expect(probableDuplicates([a, b, c]).map((g) => g.map((x) => x.trackId))).toEqual([
      [a.trackId, b.trackId],
    ]);
  });

  it('chains near neighbours into one group', () => {
    const tracks = [0, 1500, 3000].map((d) => t({ title: 'X', durationMs: 100_000 + d }));
    expect(probableDuplicates(tracks)).toHaveLength(1);
    expect(probableDuplicates(tracks)[0]).toHaveLength(3);
  });

  it('skips tracks without title, artist or duration, and excluded groups', () => {
    expect(probableDuplicates([t({ title: null }), t({ title: null })])).toEqual([]);
    const pair = [t({ title: 'Y' }), t({ title: 'Y' })];
    expect(probableDuplicates(pair, 2000, () => true)).toEqual([]);
  });
});

describe('splitAlbumFolders', () => {
  it('ignores disc folders but reports unrelated folders', () => {
    const rows = [
      t({ albumId: 1, relPath: 'A/Album/CD1/01.flac' }),
      t({ albumId: 1, relPath: 'A/Album/CD2/01.flac' }),
      t({ albumId: 2, relPath: 'A/Greatest Hits/01.flac' }),
      t({ albumId: 2, relPath: 'Compilations/Greatest Hits (copy)/01.flac' }),
    ];
    expect(splitAlbumFolders(rows)).toEqual(
      new Map([[2, ['A/Greatest Hits', 'Compilations/Greatest Hits (copy)']]]),
    );
  });
});

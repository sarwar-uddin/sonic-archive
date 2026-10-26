import type { IAudioMetadata, ICommonTagsResult, IFormat } from 'music-metadata';
import { describe, expect, it } from 'vitest';
import {
  albumFolder,
  cleanAlbumTitle,
  discFromFolder,
  folderTitle,
  splitByCue,
  toCatalogRecord,
  VARIOUS_ARTISTS,
} from './map.ts';

function meta(
  common: Partial<ICommonTagsResult> = {},
  format: Partial<IFormat> = {},
): IAudioMetadata {
  return {
    common: { track: { no: null, of: null }, disk: { no: null, of: null }, ...common },
    format: { trackInfo: [], tagTypes: [], ...format },
    native: {},
    quality: { warnings: [] },
  } as unknown as IAudioMetadata;
}

describe('toCatalogRecord: albums', () => {
  it('keys by MusicBrainz release id when present', () => {
    const r = toCatalogRecord(
      meta({ album: 'X', musicbrainz_albumid: 'ABC-123', albumartist: 'A' }),
      'A/X/01.flac',
    );
    expect(r.album.groupKey).toBe('mbid:abc-123');
  });

  it('keys by normalized album artist, title and album folder otherwise', () => {
    const a = toCatalogRecord(meta({ album: 'Ágætis', albumartist: 'Sigur Rós' }), 'S/Á/a.flac');
    const b = toCatalogRecord(meta({ album: 'agætis ', albumartist: 'SIGUR ROS' }), 'S/Á/b.flac');
    expect(a.album.groupKey).toBe('tag:sigur ros|agætis|S/Á');
    expect(b.album.groupKey).toBe(a.album.groupKey);
  });

  it('keeps two pressings of one album apart, but joins disc folders', () => {
    const tags = { album: 'Master Of Puppets (32DP 448)', albumartist: 'Metallica' };
    const japan = toCatalogRecord(meta(tags), 'M/1986 Japan 32DP 448/a.flac');
    const shm = toCatalogRecord(
      meta({ ...tags, album: 'Master Of Puppets [SHM-CD, UICR-1139, Japan]' }),
      'M/SHM-CD/a.flac',
    );
    expect(japan.album.title).toBe('Master Of Puppets');
    expect(shm.album.title).toBe('Master Of Puppets');
    expect(japan.album.groupKey).not.toBe(shm.album.groupKey);

    const cd1 = toCatalogRecord(meta({ album: 'Ummagumma (CD 1)' }), 'P/Ummagumma/CD1/a.flac');
    const cd2 = toCatalogRecord(meta({ album: 'Ummagumma (CD 2)' }), 'P/Ummagumma/CD2/a.flac');
    expect(cd1.album.groupKey).toBe(cd2.album.groupKey);
    expect([cd1.track.discNo, cd2.track.discNo]).toEqual([1, 2]);
  });

  it('drops a disc folder name ending the title, and joins those discs', () => {
    const tags = (disc: string) => ({
      album: `''Lift Yr. Skinny Fists'' [PCD-5608~9]: (${disc})`,
      albumartist: 'GYBE',
    });
    const one = toCatalogRecord(meta(tags('One')), 'G/Lift Yr [PCD-5608~9]/(One)/01.flac');
    const two = toCatalogRecord(meta(tags('Two')), 'G/Lift Yr [PCD-5608~9]/(Two)/01.flac');
    expect(one.album.title).toBe("''Lift Yr. Skinny Fists''");
    expect(one.album.groupKey).toBe(two.album.groupKey);
    expect([one.track.discNo, two.track.discNo]).toEqual([1, 2]);
  });

  it('drops a leading year from the title only when it is the album year', () => {
    const title = (album: string, year: number) =>
      toCatalogRecord(meta({ album, year }), 'x/a.flac').album.title;
    expect(title('1968 A Saucerful of Secrets', 1968)).toBe('A Saucerful of Secrets');
    expect(title('1984', 1984)).toBe('1984');
    expect(title('2112 Live', 1977)).toBe('2112 Live');
  });

  it('falls back from album artist to the first track artist', () => {
    const r = toCatalogRecord(meta({ album: 'X', artists: ['Solo', 'Guest'] }), 'x.flac');
    expect(r.album.albumArtist).toBe('Solo');
  });

  it('ignores an album tag that is only a pressing code', () => {
    const r = toCatalogRecord(
      meta({ album: '(CDP 7 46384 2) [1st UK]', albumartist: 'Pink Floyd' }),
      'Pink Floyd/1967 The Piper at the Gates of Dawn/(CDP 7 46384 2) [1st UK]/a.flac',
    );
    expect(r.album).toMatchObject({ title: 'The Piper at the Gates of Dawn', year: 1967 });
  });

  it('uses Various Artists for an untagged compilation', () => {
    const r = toCatalogRecord(meta({ album: 'Mix', artist: 'One', compilation: true }), 'm.flac');
    expect(r.album.albumArtist).toBe(VARIOUS_ARTISTS);
  });

  it('groups untitled tracks by folder, skipping disc folders', () => {
    const r = toCatalogRecord(meta(), 'Some Artist/Bootleg/CD2/03.flac');
    expect(r.album).toMatchObject({ groupKey: 'dir:Some Artist/Bootleg', title: 'Bootleg' });
  });

  it('names a root-level untitled file "Unknown Album"', () => {
    expect(toCatalogRecord(meta(), 'loose.flac').album).toMatchObject({
      groupKey: 'dir:',
      title: 'Unknown Album',
    });
  });
});

describe('toCatalogRecord: tags', () => {
  it('builds a display artist from multi-value ARTIST tags', () => {
    const r = toCatalogRecord(meta({ artist: 'A', artists: ['A', 'B'] }), 'x.flac');
    expect(r.track.displayArtist).toBe('A, B');
    expect(r.artists).toEqual(['A', 'B']);
  });

  it('keeps a single tagged artist string verbatim', () => {
    const r = toCatalogRecord(meta({ artist: 'A feat. B', artists: ['A feat. B'] }), 'x.flac');
    expect(r.track.displayArtist).toBe('A feat. B');
  });

  it('cleans whitespace, NULs and duplicates', () => {
    const r = toCatalogRecord(
      meta({
        title: '  Song\0 ',
        artists: ['Björk', 'bjork', ' ', 'Björk\0'],
        genre: ['Rock; rock;Pop', ''],
      }),
      'x.flac',
    );
    expect(r.track.title).toBe('Song');
    expect(r.artists).toEqual(['Björk']);
    expect(r.genres).toEqual(['Rock', 'Pop']);
  });

  it('derives the year from the date when no year is tagged', () => {
    expect(toCatalogRecord(meta({ date: '1997-06-16' }), 'x.flac').track.year).toBe(1997);
    expect(toCatalogRecord(meta({ date: 'unknown' }), 'x.flac').track.year).toBeNull();
    expect(toCatalogRecord(meta({ year: 0 }), 'x.flac').track.year).toBeNull();
  });

  it('accepts only positive integers for track and disc numbers', () => {
    const r = toCatalogRecord(
      meta({ track: { no: 0, of: 12 }, disk: { no: 2, of: -1 } }),
      'x.flac',
    );
    expect(r.track).toMatchObject({ trackNo: null, trackTotal: 12, discNo: 2, discTotal: null });
  });
});

describe('toCatalogRecord: format', () => {
  it('maps technical details', () => {
    const r = toCatalogRecord(
      meta(
        {},
        {
          codec: 'FLAC',
          container: 'FLAC',
          lossless: true,
          sampleRate: 96000,
          bitsPerSample: 24,
          numberOfChannels: 2,
          duration: 61.2346,
          bitrate: 2500000.4,
        },
      ),
      'x.flac',
    );
    expect(r.track).toMatchObject({
      codec: 'FLAC',
      lossless: true,
      sampleRate: 96000,
      bitDepth: 24,
      channels: 2,
      durationMs: 61235,
      bitrate: 2500000,
    });
  });

  it('drops bit depth for lossy formats', () => {
    const r = toCatalogRecord(
      meta({}, { codec: 'MP3', lossless: false, bitsPerSample: 16 }),
      'x.mp3',
    );
    expect(r.track.bitDepth).toBeNull();
  });
});

describe('toCatalogRecord: artwork', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it('prefers the front cover and normalizes image/jpg', () => {
    const r = toCatalogRecord(
      meta({
        picture: [
          { format: 'image/png', type: 'Artist/performer', data: new Uint8Array([1]) },
          { format: 'image/jpg', type: 'Cover (front)', data: jpeg },
        ],
      }),
      'x.flac',
    );
    expect(r.picture).toEqual({ mime: 'image/jpeg', data: jpeg });
    expect(r.track.hasEmbeddedArt).toBe(true);
  });

  it('treats empty picture data as no artwork', () => {
    const r = toCatalogRecord(
      meta({ picture: [{ format: 'image/jpeg', data: new Uint8Array() }] }),
      'x.flac',
    );
    expect(r.picture).toBeNull();
    expect(r.track.hasEmbeddedArt).toBe(false);
  });
});

describe('folderTitle', () => {
  it.each([
    ['Pink Floyd/Studio/1971 Meddle/(CDP 7 46034 2) [1st UK]', 'Meddle', 1971],
    [
      'Black Sabbath/1970 Paranoid/1970 Paranoid [1991 Japan TECP-23893 Teichiku]',
      'Paranoid',
      1970,
    ],
    ['GYBE/1998. F♯ A♯ ∞ [2000, PCD-23058]', 'F♯ A♯ ∞', 1998],
    ['Death - Symbolic [Roadrunner Records, RR 8957-2, Netherlands]', 'Death - Symbolic', null],
    ['Untagged', 'Untagged', null],
    ['[Bootlegs]', '[Bootlegs]', null],
    ['', 'Unknown Album', null],
  ])('%s → %s (%s)', (dir, title, year) => {
    expect(folderTitle(dir)).toEqual({ title, year });
  });
});

describe('albumFolder', () => {
  it.each([
    ['A/B/01.flac', 'A/B'],
    ['A/B/CD1/01.flac', 'A/B'],
    ['A/B/Disc 2/01.flac', 'A/B'],
    ['A/B/disk3/01.flac', 'A/B'],
    ['A/B/CD Extras/01.flac', 'A/B/CD Extras'],
    ['A/B/Disc 1of2/01.flac', 'A/B'],
    ['A/B/CD 1 (50DP361)/01.flac', 'A/B'],
    ['A/B/CD2 - Bonus CD/01.flac', 'A/B'],
    ['A/B/CD1 ]CD_X_X001J, JP]/01.flac', 'A/B'],
    ['A/B/CDs I Love/01.flac', 'A/B/CDs I Love'],
    ['01.flac', ''],
  ])('%s -> %s', (relPath, expected) => {
    expect(albumFolder(relPath)).toBe(expected);
  });
});

describe('cleanAlbumTitle', () => {
  // Every case comes from a CUE sheet or tag in the collection this was built for.
  it.each([
    ['Paranoid (TECP-23893)', 'Paranoid'],
    ['Dark Side of the Moon.CP35-3017.Japan', 'Dark Side of the Moon'],
    ['The Wall.50DP361.Japan', 'The Wall'],
    ['Ummagumma (CD 1)', 'Ummagumma'],
    ['Deadwing - Japan CD1 (IECP-20003)', 'Deadwing'],
    ['Deadwing - Japan Bonus Disc (IECP-20004)', 'Deadwing'],
    ['Leviathan [Japan]', 'Leviathan'],
    ['Still Life (CDVILED78)', 'Still Life'],
    ['Rust In Peace (1990 Capitol, CDP 7 91935 2, USA)', 'Rust In Peace'],
    ['The Soft Parade (975 005-2)', 'The Soft Parade'],
    ['Symbolic [Roadrunner Records, RR 8957-2, Netherlands]', 'Symbolic'],
  ])('%s → %s', (input, expected) => {
    expect(cleanAlbumTitle(input)).toBe(expected);
  });

  it.each([
    'Damnation (Metal Mind)',
    'Nuovo Cinema Paradiso [Original Motion Picture Soundtrack]',
    'Koyaanisqatsi (complete original soundtrack version)',
    'Metropolis Pt. 2 : Scenes From A Memory',
    'Greatest Hits Vol.12',
    'Live 1972',
    '(Japan)',
  ])('keeps %s', (title) => {
    expect(cleanAlbumTitle(title)).toBe(title);
  });
});

describe('discFromFolder', () => {
  it.each([
    ['A/CD1/x.flac', 1],
    ['A/Disc 2of2/x.flac', 2],
    ['A/CD 1 (50DP361)/x.flac', 1],
    ['A/CD2 - Bonus CD/x.flac', 2],
    ['A/(Two)/x.flac', 2],
    ['A/One/x.flac', null],
    ['A/Album/x.flac', null],
  ])('%s → %s', (relPath, disc) => {
    expect(discFromFolder(relPath)).toBe(disc);
  });
});

describe('splitByCue', () => {
  it('makes one record per segment, keeping album and format', () => {
    const record = toCatalogRecord(
      meta(
        { album: 'Image', artist: 'Band', composer: ['Writer'] },
        { codec: 'FLAC', duration: 90 },
      ),
      'Band/Image/image.flac',
    );
    const [first, second] = splitByCue(record, [
      { number: 1, title: 'One', performer: null, startMs: 0, endMs: 60_000, durationMs: 60_000 },
      {
        number: 2,
        title: 'Two',
        performer: 'Guest',
        startMs: 60_000,
        endMs: null,
        durationMs: 30_000,
      },
    ]);
    expect(first?.track).toMatchObject({
      segment: 1,
      trackNo: 1,
      trackTotal: 2,
      title: 'One',
      displayArtist: 'Band',
      codec: 'FLAC',
      startMs: 0,
      endMs: 60_000,
    });
    expect(second?.track).toMatchObject({
      segment: 2,
      title: 'Two',
      displayArtist: 'Guest',
      durationMs: 30_000,
      endMs: null,
    });
    expect(second?.artists).toEqual(['Guest']);
    expect(first?.composers).toEqual([]);
    expect(first?.album).toEqual(record.album);
  });
});

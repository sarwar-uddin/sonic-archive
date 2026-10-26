import type { AlbumDetail, AlbumSummary, Stats, TrackSummary } from '@sonic-archive/contracts';

export function track(overrides: Partial<TrackSummary> & { id: number }): TrackSummary {
  return {
    title: `Track ${overrides.id}`,
    displayArtist: 'Basalt Quartet',
    artists: [{ id: 1, name: 'Basalt Quartet' }],
    trackNo: overrides.id,
    discNo: null,
    year: 2020,
    durationMs: 245_000,
    codec: 'FLAC',
    container: 'FLAC',
    lossless: true,
    sampleRate: 96_000,
    bitDepth: 24,
    channels: 2,
    bitrate: 2_400_000,
    hasEmbeddedArt: false,
    span: null,
    file: {
      relPath: `Basalt/${overrides.id}.flac`,
      size: 40_000_000,
      status: 'present',
      audioMd5: null,
    },
    ...overrides,
  };
}

export const albumSummary: AlbumSummary = {
  id: 7,
  title: 'Hi-Res Session',
  albumArtist: { id: 1, name: 'Basalt Quartet' },
  year: 2020,
  artworkId: null,
  trackCount: 3,
  durationMs: 735_000,
  codecs: ['FLAC'],
  maxSampleRate: 96_000,
  maxBitDepth: 24,
  lossless: true,
  kind: 'release',
  edition: ['1st Japan', 'SICP-1234'],
  rip: null,
  pressings: 1,
};

export const albumDetail: AlbumDetail = {
  ...albumSummary,
  scans: [],
  ripLogs: [],
  otherPressings: [],
  musicbrainzAlbumId: null,
  totalDiscs: 2,
  genres: [{ id: 3, name: 'Chamber' }],
  totalBytes: 120_000_000,
  discs: [
    {
      discNo: 1,
      tracks: [
        track({ id: 1, title: 'Overture', discNo: 1, trackNo: 1 }),
        track({ id: 2, title: 'Interlude', discNo: 1, trackNo: 2, displayArtist: 'Guest Cellist' }),
      ],
    },
    {
      discNo: 2,
      tracks: [
        track({
          id: 3,
          title: 'Coda',
          discNo: 2,
          trackNo: 1,
          codec: 'ALAC',
          sampleRate: 44_100,
          bitDepth: 16,
          file: {
            relPath: 'Basalt/CD2/01 Coda.m4a',
            size: 30_000_000,
            status: 'missing',
            audioMd5: null,
          },
        }),
      ],
    },
  ],
};

export const stats: Stats = {
  albums: 1,
  artists: 1,
  tracks: 3,
  durationMs: 735_000,
  totalBytes: 120_000_000,
  missingFiles: 1,
  errorFiles: 0,
  formats: [{ codec: 'FLAC', sampleRate: 96_000, bitDepth: 24, trackCount: 2 }],
};

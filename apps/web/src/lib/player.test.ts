import { describe, expect, it } from 'vitest';
import { continues, createPlayer, type QueueItem } from './player.ts';

/** Just enough of an <audio> element to drive the player. */
class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  volume = 1;
  paused = true;
  ended = false;
  play() {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
}

const item = (over: Partial<QueueItem>): QueueItem => ({
  trackId: 1,
  title: 'T',
  artist: null,
  albumId: 1,
  albumTitle: 'A',
  artworkId: null,
  fileId: 10,
  playback: 'direct',
  startMs: 0,
  endMs: null,
  durationMs: 60_000,
  ...over,
});

// Three tracks of one CD image, then a separate file.
const image = [
  item({ trackId: 1, startMs: 0, endMs: 60_000 }),
  item({ trackId: 2, startMs: 60_000, endMs: 120_000 }),
  item({ trackId: 3, startMs: 120_000, endMs: null }),
  item({ trackId: 4, fileId: 11 }),
];

function setup() {
  const audio = new FakeAudio();
  const player = createPlayer(audio as unknown as HTMLAudioElement);
  return { audio, player };
}

describe('player', () => {
  it('knows when a track continues the same file without a gap', () => {
    expect(continues(image[0] as QueueItem, image[1])).toBe(true);
    expect(continues(image[2] as QueueItem, image[3])).toBe(false);
    expect(continues(image[3] as QueueItem, undefined)).toBe(false);
  });

  it('plays a span of an image by seeking inside the one file', () => {
    const { audio, player } = setup();
    player.play(image, 1);
    expect(audio.src).toBe('/api/files/10/audio');
    expect(audio.currentTime).toBe(60);
    expect(player.getState()).toMatchObject({ index: 1, playing: true });
  });

  it('keeps the file playing across track boundaries of an image', () => {
    const { audio, player } = setup();
    player.play(image, 0);
    audio.currentTime = 30;
    player.next(); // same file: a seek, no reload
    expect(audio.src).toBe('/api/files/10/audio');
    expect(audio.currentTime).toBe(60);
    player.next();
    player.next(); // another file
    expect(audio.src).toBe('/api/files/11/audio');
    expect(audio.currentTime).toBe(0);
  });

  it('moves to the next file when one ends, and stops after the last', () => {
    const { audio, player } = setup();
    player.play(image, 2);
    audio.ended = true;
    audio.dispatchEvent(new Event('ended'));
    expect(player.getState().index).toBe(3);
    expect(audio.src).toBe('/api/files/11/audio');
    audio.dispatchEvent(new Event('ended'));
    expect(player.getState()).toMatchObject({ index: 3, playing: false });
  });

  it('asks for a converted stream starting where it should', () => {
    const { audio, player } = setup();
    const ape = [
      item({ trackId: 1, fileId: 20, playback: 'transcode', startMs: 0, endMs: 90_000 }),
      item({ trackId: 2, fileId: 20, playback: 'transcode', startMs: 90_000, endMs: null }),
    ];
    player.play(ape, 1);
    expect(audio.src).toBe('/api/files/20/audio?start=90.000');
    player.seek(15_000);
    expect(audio.src).toBe('/api/files/20/audio?start=105.000');
  });

  it('goes back to the start of the track first, like a CD player', () => {
    const { player } = setup();
    player.play(image, 3);
    player.seek(10_000);
    player.previous();
    expect(player.getState()).toMatchObject({ index: 3, positionMs: 0 });
    player.previous();
    expect(player.getState().index).toBe(2);
  });

  it('stops and says so when a track cannot be played, and tries again on the next play', () => {
    const { audio, player } = setup();
    player.play([item({ fileId: 12, playback: 'transcode' }), item({ fileId: 13 })], 0);
    audio.dispatchEvent(new Event('error'));
    expect(player.getState()).toMatchObject({ index: 0, playing: false, failed: true });

    audio.src = '';
    player.toggle();
    expect(player.getState()).toMatchObject({ playing: true, failed: false });
    expect(audio.src).toBe('/api/files/12/audio');
    player.next();
    expect(player.getState()).toMatchObject({ index: 1, playing: true, failed: false });
  });

  it('pauses and resumes, and sets the volume', () => {
    const { audio, player } = setup();
    player.play(image, 0);
    player.toggle();
    expect(audio.paused).toBe(true);
    expect(player.getState().playing).toBe(false);
    player.toggle();
    expect(player.getState().playing).toBe(true);
    player.setVolume(1.5);
    expect(player.getState().volume).toBe(1);
  });
});

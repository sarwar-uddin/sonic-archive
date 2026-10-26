import { describe, expect, it } from 'vitest';
import { playbackOf } from './playback.ts';

describe('playbackOf', () => {
  it.each([
    ['a/01.flac', 'FLAC', { mode: 'direct', mime: 'audio/flac' }],
    ['a/01.MP3', 'MPEG 1 Layer 3', { mode: 'direct', mime: 'audio/mpeg' }],
    ['a/01.opus', 'Opus', { mode: 'direct', mime: 'audio/ogg' }],
    ['a/01.wav', 'PCM', { mode: 'direct', mime: 'audio/wav' }],
    ['a/01.m4a', 'MPEG-4/AAC', { mode: 'direct', mime: 'audio/mp4' }],
    ['a/01.m4a', 'ALAC', { mode: 'transcode' }],
    ['a/image.ape', "Monkey's Audio", { mode: 'transcode' }],
    ['a/01.aiff', 'PCM', { mode: 'transcode' }],
    ['a/01.dsf', 'DSD', { mode: 'transcode' }],
    ['a/01.wv', 'WavPack', { mode: 'transcode' }],
  ])('%s (%s)', (relPath, codec, expected) => {
    expect(playbackOf(relPath, codec)).toEqual(expected);
  });
});

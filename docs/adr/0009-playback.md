# 0009 — Playback: the file as stored, CD images as one stream

- Status: accepted
- Date: 2026-10-27

## Context

Full-album playback, including the 60 single-file CD images that M7 split
into tracks by their CUE sheets. Browsers decode FLAC, MP3, Ogg, PCM WAV and
AAC, but not ALAC, Monkey's Audio, WavPack, DSD or AIFF. The server so far
never read the library (docs/safety.md).

## Decision

- **Serve files as stored** when the browser can decode them, with HTTP
  byte ranges so the browser can seek. No conversion, no cache copy.
- **Convert the rest to FLAC on the fly** with ffmpeg (lossless, played by
  every current browser). A converted stream cannot be seeked by range, so
  the client asks for a new stream with `?start=<seconds>` instead.
- **One player outside React** (`apps/web/src/lib/player.ts`) owns a single
  `<audio>` element and the queue, so playback survives navigation.
- **CD images play as one stream.** A track of an image is a span of a file.
  When the next track continues the same file at the same position, the
  element keeps playing and only the "current track" changes: whole-album
  playback of an image is exactly as gapless as the disc. Track ends are
  checked every animation frame, not on `timeupdate` (4 Hz), so a single
  track stops within a few milliseconds instead of spilling into the next.
- The browser's Media Session API gets title, artist, album and cover, so
  media keys and the desktop's media controls work.

## Consequences

- Separate files (one per track) are played back to back with the small gap
  a new `<audio>` load costs. True gapless across files would need decoding
  through Web Audio; it can be added later if it is missed.
- The server reads the library during playback; docs/safety.md describes
  how that stays read-only and id-addressed.

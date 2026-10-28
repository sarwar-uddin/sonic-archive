# Changelog

All notable changes to Sonic Archive. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-28

The first release: a catalog for a lossless CD collection that reads your
music and never writes it.

### Getting started

- Choose your music folder in the app on first run: browse to it or paste
  its path. It is scanned in the background, then followed while the app
  runs: new rips, retags and deletions show up within seconds, and open
  pages refresh themselves. Settings changes the folder, rescans, or stops
  watching.

### The collection

- Album-centric: a cover grid with artist dividers, sorting and filters
  (genre, year, format, sample rate, bit depth), and a switch between
  releases, loose tracks and everything.
- A shelf view: CD spines in their covers' colors, OBI bands on Japanese
  pressings, letter dividers.
- Artist pages with their own albums and appearances, and a virtualized
  tracks table with technical filters.
- Quick search from anywhere with `/` or Ctrl-K.

### Albums

- Single-file CD images are split into their tracks by their CUE sheets,
  and the discs of a set join into one album. Album titles, performers and
  years come from the sheet when the files aren't tagged.
- Covers from folder scans (JPEG, PNG, TIFF) or embedded art, served as
  WebP.
- A scan viewer for sleeves, booklets, discs and OBI strips, full screen
  for reading liner notes.
- Rip verification from EAC (English, Russian, Spanish), XLD and CUETools
  logs: AccurateRip and CUETools-database results, read errors and CRCs,
  one verdict per album, and the full log readable in the app.
- Pressings of one album compared side by side: pressing, year, format,
  length, rip verdict and dynamic range.
- Dynamic range (the DR meter of the Dynamic Range Database) per track,
  album and pressing; needs ffmpeg.

### Playback

- Albums play in the browser, in a player bar with a queue, seeking and
  media keys. CD images play gapless as one stream; ALAC, APE, WavPack,
  DSD and AIFF are converted to FLAC while playing (needs ffmpeg).

### The Ledger and health

- Collection statistics: releases by decade, countries of pressing, rip
  verification, dynamic range by decade, genres, most-collected artists,
  formats and scan history.
- A health report: missing or unreadable files, metadata gaps, missing
  artwork, exact and probable duplicates, split albums, and rips whose logs
  differ or report problems.

### Command line

- `pnpm paths`, `pnpm scan --confirm` (with `--dry-run` and `--subpath`)
  and `pnpm analyze --confirm`.

### Safety

- The music folder is read-only, enforced by a single read-only module and
  tests that fail on write calls. The catalog lives in your XDG folders.
- Loopback only, a Host allowlist, and an Origin check plus session token
  for the three requests that change settings. Nothing leaves your
  computer.

[0.1.0]: https://github.com/sarwar-uddin/sonic-archive/releases/tag/v0.1.0

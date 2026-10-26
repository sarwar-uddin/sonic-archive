# Sonic Archive

A local-first, album-centric catalog for a personal lossless music collection.
The library is treated as strictly read-only; see [docs/safety.md](docs/safety.md).

## Requirements

- [mise](https://mise.jdx.dev) (pins Node 26.12.1 via `mise.toml`)
- pnpm 12.15.0

## Getting started

```sh
mise install
pnpm install
pnpm start      # build and run: open http://127.0.0.1:4317
```

On first run the app asks where your music is: browse to the folder (or
paste its path) and choose it. It is scanned in the background, then kept
up to date while the app runs; covers, booklet scans, rip logs and dynamic
range follow. Settings lets you change the folder, rescan, or stop watching.
Your music files are only ever read ([docs/safety.md](docs/safety.md)), and
the app answers only on this computer.

`ffmpeg` on your `PATH` enables playback of formats browsers cannot decode
(ALAC, APE, WavPack, DSD, AIFF) and dynamic range measurement.

For development:

```sh
pnpm check      # typecheck + lint + tests
pnpm dev        # API on 127.0.0.1:4317 + web app on http://127.0.0.1:5173
pnpm paths      # show where config, database and cache live
pnpm scan       # scan from the command line (needs --confirm)
pnpm analyze    # measure dynamic range from the command line (needs --confirm)
```

## Layout

| Path                 | Purpose                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `packages/catalog`   | Domain core: config, scanner, database, read queries (no HTTP)         |
| `packages/contracts` | API query schemas and response types, shared by server and web         |
| `apps/server`        | CLI and the Express API (reads, plus three guarded settings actions)   |
| `apps/web`           | React frontend (Vite)                                                  |
| `docs/adr`           | Architecture decision records                                          |
| `test-fixtures`      | Synthetic audio library for tests ([details](test-fixtures/README.md)) |

## API

All endpoints are `GET`, return JSON, and address resources by numeric id.

| Endpoint                           | Purpose                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`, `/api/stats`        | Library status, last scan, totals, format breakdown                                                                               |
| `/api/albums`, `/api/albums/:id`   | Filter by `q`, `artistId`, `genreId`, `yearFrom`/`yearTo`, `codec`, `lossless`, `minSampleRate`, `minBitDepth`; sort and paginate |
| `/api/tracks`                      | Track list with technical filters (`bitDepth`, `durationMin`/`durationMax` in seconds, …)                                         |
| `/api/artists`, `/api/artists/:id` | Artists with their own albums and appearances                                                                                     |
| `/api/search?q=`                   | Grouped full-text search                                                                                                          |
| `/api/facets`                      | Genres, years, codecs, sample rates, bit depths                                                                                   |
| `/api/artwork/:id`                 | Cover image from the cache                                                                                                        |
| `/api/scans`, `/api/scans/:id`     | Scan history                                                                                                                      |
| `/api/health-report`               | Missing/unreadable files, metadata issues, missing artwork, exact/probable duplicates, split albums                               |

## Changing the database schema

1. Edit `packages/catalog/src/db/schema.ts`.
2. Run `pnpm --filter @sonic-archive/catalog db:generate --name <what-changed>`.
3. Read the generated SQL in `packages/catalog/drizzle/`. If it contains
   `DROP` or `DELETE`, confirm that no data is lost, then add
   `-- safety-reviewed: <reason>` to that statement. Otherwise tests fail and
   the runner refuses to apply it.
4. `pnpm check`, then commit the schema, SQL, and `meta/` together.

## Status

Milestones **M0–M17** are complete, plus a collection-led redesign: the
library has been scanned in full (read-only; verified unchanged afterwards).
Covers come from folder scans (JPEG/PNG/TIFF) and are served as WebP
thumbnails. Single-file CD images are split into their tracks by their CUE
sheets, and the discs of a set join into one album
([ADR 0007](docs/adr/0007-cd-images-and-album-identity.md)).

Each album page shows the scanned sleeve, booklet, discs and OBI from its
folder, with a full-screen viewer for reading liner notes.

Rip logs (EAC in English, Russian or Spanish, XLD, CUETools) are read for
AccurateRip and CUETools-database results, read errors and CRC checks; each
album gets a verdict, and the full log can be read in the app.

Pressings of one album (same artist and title, different folders) are
compared side by side on the album page.

Press `/` or Ctrl-K anywhere for a quick-search palette.

The Ledger charts the collection: releases by decade, countries of pressing,
rip verification, genres and most-collected artists.

Albums play in the browser: files as stored, CD images gapless as one
stream, other formats (ALAC, APE, DSD…) converted to FLAC while playing
([ADR 0009](docs/adr/0009-playback.md)).

The catalog follows the music folder while the app runs: changes are picked
up within seconds, and open pages refresh themselves.

`pnpm analyze --confirm` measures each track's dynamic range (the DR meter
used by the Dynamic Range Database), shown per album, per pressing and per
decade on the Ledger; new tracks are measured after each scan.

Anyone can install it: the music folder is chosen inside the app
([ADR 0010](docs/adr/0010-app-for-everyone.md)).

The collection can also stand on a shelf: CD spines in their covers' colors,
OBI bands on Japanese pressings, letter dividers.

Ideas for later: lyrics, ratings and notes, playlists, several music folders.

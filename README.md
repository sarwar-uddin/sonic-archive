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
pnpm check      # typecheck + lint + tests
pnpm paths      # show where config, database and cache live
pnpm db:migrate # create or upgrade the catalog database (backs up first)
pnpm scan       # index the library: read-only, needs --confirm (see docs/safety.md)
pnpm dev        # API on 127.0.0.1:4317 + web app on http://127.0.0.1:5173
pnpm start      # production: build the web app and serve everything on http://127.0.0.1:4317
```

## Layout

| Path                 | Purpose                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `packages/catalog`   | Domain core: config, scanner, database, read queries (no HTTP)         |
| `packages/contracts` | API query schemas and response types, shared by server and web         |
| `apps/server`        | CLI and the read-only Express API                                      |
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

## Changing the database schema

1. Edit `packages/catalog/src/db/schema.ts`.
2. Run `pnpm --filter @sonic-archive/catalog db:generate --name <what-changed>`.
3. Read the generated SQL in `packages/catalog/drizzle/`. If it contains
   `DROP` or `DELETE`, confirm that no data is lost, then add
   `-- safety-reviewed: <reason>` to that statement. Otherwise tests fail and
   the runner refuses to apply it.
4. `pnpm check`, then commit the schema, SQL, and `meta/` together.

## Status

The MVP (milestones M0–M4) is complete: foundation, database, read-only
scanner, API, and web frontend. Two real album folders have been
sample-scanned (M2.5); the full-library scan is waiting for explicit
approval. Later milestones: library health reports (M5), artwork thumbnails
(M6), ratings and notes (M7), playlists (M8), and optional playback (M9).

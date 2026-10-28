# Development

```sh
mise install    # Node and pnpm at the pinned versions
pnpm install
pnpm dev        # API on 127.0.0.1:4317 + web app with hot reload on http://127.0.0.1:5173
pnpm check      # typecheck + lint (Biome) + tests (Vitest)
pnpm format     # format and fix lint where possible
```

`pnpm dev` uses your real config and catalog. To try things without touching
them, point the XDG folders somewhere else:

```sh
XDG_CONFIG_HOME=/tmp/sa/config XDG_DATA_HOME=/tmp/sa/data XDG_CACHE_HOME=/tmp/sa/cache pnpm dev
```

Then choose `test-fixtures/library`, a small synthetic library
([details](../test-fixtures/README.md)), as the music folder.

Before changing anything that reads the music folder, read
[safety.md](safety.md): its rules come first, and tests enforce most of them.
Design decisions are recorded in [adr/](adr/).

## Layout

| Path                 | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `packages/catalog`   | Domain core: config, scanner, database, read queries (no HTTP)            |
| `packages/contracts` | API query schemas and response types, shared by server and web            |
| `apps/server`        | CLI and the Express API (reads, plus three guarded settings actions)      |
| `apps/web`           | React frontend (Vite)                                                     |
| `docs/adr`           | Architecture decision records                                             |
| `test-fixtures`      | Synthetic audio library for tests ([details](../test-fixtures/README.md)) |

## API

JSON over HTTP on `127.0.0.1:4317`; resources are addressed by numeric id.
Request and response types live in `packages/contracts`.

| Endpoint                               | Purpose                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`, `/api/stats`        | Library status, last scan, totals, format breakdown                                                                                                                                                     |
| `GET /api/statistics`                  | The Ledger: decades, countries, rip verdicts, dynamic range, genres, artists                                                                                                                            |
| `GET /api/albums`, `/api/albums/:id`   | Filter by `q`, `artistId`, `genreId`, `yearFrom`/`yearTo`, `codec`, `lossless`, `minSampleRate`, `minBitDepth`, `kind`; sort and paginate. One album includes its tracks, scans, rip logs and pressings |
| `GET /api/tracks`                      | Track list with technical filters (`bitDepth`, `durationMin`/`durationMax` in seconds, …)                                                                                                               |
| `GET /api/artists`, `/api/artists/:id` | Artists with their own albums and appearances                                                                                                                                                           |
| `GET /api/search?q=`                   | Grouped full-text search                                                                                                                                                                                |
| `GET /api/facets`                      | Genres, years, codecs, sample rates, bit depths                                                                                                                                                         |
| `GET /api/artwork/:id?size=`           | A cover or scan from the cache, as WebP                                                                                                                                                                 |
| `GET /api/rip-logs/:id`                | One rip log's text and what it says                                                                                                                                                                     |
| `GET /api/files/:id/audio`             | A file's audio, with byte ranges; converted to FLAC with ffmpeg if browsers can't play it (`?start=` seeks)                                                                                             |
| `GET /api/scans`, `/api/scans/:id`     | Scan history                                                                                                                                                                                            |
| `GET /api/health-report`               | Missing/unreadable files, metadata issues, missing artwork, duplicates, split albums, rip problems                                                                                                      |
| `GET /api/library`, `/api/events`      | Music folder status; server-sent events for scans and library changes                                                                                                                                   |
| `GET /api/folders?path=`               | Subfolder names of one folder, for the folder picker                                                                                                                                                    |
| `GET /api/session`                     | The session token that write requests must carry                                                                                                                                                        |
| `PUT /api/library`                     | Choose the music folder `{ path }`                                                                                                                                                                      |
| `POST /api/library/scan`               | Rescan `{ full? }`                                                                                                                                                                                      |
| `PUT /api/library/settings`            | Turn watching on or off `{ watch }`                                                                                                                                                                     |

The three write requests need the app's own `Origin`, the `X-Sonic-Token`
header and a JSON body ([safety.md](safety.md#changes-from-the-app-m16)).
Every other method is refused.

## Changing the database schema

1. Edit `packages/catalog/src/db/schema.ts`.
2. Run `pnpm --filter @sonic-archive/catalog db:generate --name <what-changed>`.
3. Read the generated SQL in `packages/catalog/drizzle/`. If it contains
   `DROP` or `DELETE`, confirm that no data is lost, then add
   `-- safety-reviewed: <reason>` to that statement. Otherwise tests fail and
   the runner refuses to apply it.
4. `pnpm check`, then commit the schema, SQL, and `meta/` together.

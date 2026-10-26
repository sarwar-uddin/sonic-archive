# Data-safety invariants

These rules come first. Each one names its enforcement and the milestone that
implements it. A rule marked _planned_ is not enforced yet: do not rely on it
until its milestone lands.

| #   | Invariant                                                                                  | Enforcement                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status                                                        |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Original music files are never modified, moved, renamed, deleted, retagged, or transcoded. | All library I/O goes through `fs/library-reader.ts` (list, lstat, parse tags, read a 42-byte header, read cover images). `safety/read-only.test.ts` fails if write APIs, write flags, or process spawning appear in `fs/`, `scanner/` or `metadata/`. Integration tests scan a write-protected fixture copy twice in full mode and compare every file's SHA-256, size, mtime, and mode before and after.                                     | **done (M2)**                                                 |
| 2   | Only the configured library root is ever indexed.                                          | The root comes from config.json (written by the in-app folder picker, M16) or `SONIC_LIBRARY_ROOT`, which the app cannot override. Wherever it comes from, `validateLibraryRoot` rejects relative paths, NUL bytes, missing or non-directory paths, `/`, the home directory and its ancestors (also through symlinks), and any overlap with the app's own config, data or cache directories. Under test, roots outside the temp dir or `test-fixtures/` are refused. | **done (M0)**: `packages/catalog/src/config/validate-root.ts` |
| 3   | The home directory and other arbitrary directories are never scanned.                      | As #2. The walker never follows symlinks (they are counted and skipped), skips hidden entries, FIFOs and devices, and every file read re-checks containment with `resolveInsideRoot` (realpath).                                                                                                                                                                                                                                             | **done (M0/M2)**                                              |
| 4   | The collection is scanned only after its owner chooses it. | Nothing is read before a folder is chosen in the app (or configured). Once chosen, it is scanned when the app starts and, if watching is on (Settings), whenever it changes: incremental scans with all the safeguards of `pnpm scan --confirm`. The CLI still requires `--confirm`. Under test, both `loadConfig` and `createLibraryReader` refuse any root outside the temp dir or `test-fixtures/`. | **done (M0/M2)**                                              |
| 5   | Database, cache, and generated data live outside the collection and out of Git.            | XDG directories (`pnpm paths` shows them); overlap with the root is rejected; the database is created only in the data dir and artwork only in the cache dir; `.gitignore` covers `*.db*` and `.data/`.                                                                                                                                                                                                                                      | **done (M0–M2)**                                              |
| 6   | Localhost only.                                                                            | `main.ts` hard-codes `127.0.0.1` (not configurable). `hostGuard` refuses any `Host` header other than localhost/127.0.0.1/[::1] (DNS rebinding). No CORS headers; `nosniff`, deny-all CSP on API responses, `X-Frame-Options: DENY`.                                                                                                                                                                                                         | **done (M3)**                                                 |
| 7   | No path traversal or arbitrary filesystem access via the API.                              | The only endpoint that accepts a path is the music folder picker: `GET /api/folders` lists one folder's subfolder names (no files, no recursion), and `PUT /api/library` sets the folder after `validateLibraryRoot`. Everything else is addressed by numeric id, with strict schemas that reject unknown parameters. Every stored path is re-checked inside the root (`resolveInsideRoot`) before a read. Requests are served from a read-only SQLite connection (`query_only`). | **done (M2/M3)**                                              |
| 8   | No library data leaves the machine.                                                        | No telemetry, no online metadata lookups, no CDN assets: fonts are bundled from npm. The production web app's CSP allows only same-origin connections. Verified with a headless browser: every page made zero non-local requests.                                                                                                                                                                                                            | **done (M4)**, ongoing policy                                 |
| 9   | No destructive migrations.                                                                 | Generated SQL is committed after review. A test rejects committed `DROP TABLE`, `ALTER … DROP`, or `DELETE FROM` without a `-- safety-reviewed: <reason>` marker, and the runner refuses to apply such a migration. A `VACUUM INTO` snapshot is taken before migrating any non-empty database, and pending migrations run in one transaction.                                                                                                | **done (M1)**: `db/migrate.ts`, `db/migration-guard.ts`       |
| 10  | Missing files are reported, not deleted.                                                   | No code path deletes a file row. After a complete, full-scope scan, unseen files get `status = missing`. Scoped, cancelled, failed, or partially unreadable scans never sweep. If 10 or more files and more than 20% of known files would go missing, the scan aborts unless `--allow-mass-missing` is given.                                                                                                                                | **done (M1/M2)**                                              |

## Changes from the app (M16)

Three requests change anything, and none can touch a music file:
`PUT /api/library` (choose the music folder), `POST /api/library/scan`
(rescan) and `PUT /api/library/settings` (watching on or off). Every other
method is refused before routing (`readOnlyMethods`). These three must pass
`writeGuard`, which stops other websites from sending them through your
browser (cross-site request forgery):

- the `Origin` header must be this server itself;
- the `X-Sonic-Token` header must match a random token created when the
  server starts, which only the app's own page can read from
  `/api/session` (no CORS headers are ever sent);
- the body must be JSON (other sites cannot send it without a CORS
  preflight, which is never granted).

The Host allowlist still applies first, which defeats DNS rebinding.
Switching to another folder rebuilds the catalog (all derived data) for the
new folder; the cover cache is kept.

## Artwork

Covers come from image files in the album folder (`cover`, `folder`, `front`,
… in JPG/PNG/WebP/GIF, also inside `Artwork/` or `Scans/`), falling back to
embedded pictures. They are read through the same read-only reader (capped at
20 MB) and copied to the cache dir, never written to the library, named by
SHA-256. The image type is detected from the bytes; only JPEG, PNG, GIF and
WebP are kept, so a tag or a file can never smuggle SVG or HTML into what the
app will later serve.

Scanned artwork (booklet pages, back covers, discs; M8) is read the same way
and never copied whole: the scanner (CLI process) decodes each image and
writes a WebP viewing copy of at most 2000 px to the cache. The server still
reads only the cache, never the library. A scan folder is searched only if it
holds no audio of its own (or is a disc folder), so one album never picks up
another album's images.

Rip logs (EAC/XLD `.log`, CUETools `.accurip`; M9) are read the same way,
capped at 2 MB, decoded to text and stored in the catalog database, so the
app can show them without reading the library again. Only files that parse
as rip logs are kept.

## Playback (M13)

Playing music is the one time the **API server** reads library files; until
M13 only the scanner did. The same rules hold:

- Read-only: files are opened through the library reader only (read
  streams, flag `r`); nothing in the library is ever written.
- No paths from the network: `GET /api/files/:id/audio` takes a catalog id.
  The stored path is re-checked by `resolveInsideRoot` (no `..`, no symlink
  leading outside the root) and must be a regular audio file.
- Formats browsers cannot play (ALAC, APE, WavPack, DSD, AIFF) are decoded
  by `ffmpeg`, spawned without a shell, with exactly one input (the library
  file, as a `file:` URL with `-protocol_whitelist file`) and one output
  (`pipe:1` to the server). Nothing is written to disk; at most three
  conversions run at once. The arguments are unit-tested (`audio.test.ts`).
  This code lives in the server, outside the library-facing modules that the
  static read-only test scans for process spawning.
- Bound to 127.0.0.1 with the Host allowlist, like every other endpoint.

## Dynamic range analysis (M15)

`pnpm analyze --confirm` (and `start:watch` after each scan) decodes audio
to measure dynamic range. ffmpeg is spawned the same way as for playback
(`apps/server/src/analyze.ts`): no shell, one `file:` input validated by the
library reader, raw samples to `pipe:1`, nothing written to disk. Results go
to the `track_dynamics` table, stamped with each file's size and mtime.

## Automatic updates (M14, opt-in)

`pnpm start:watch` starts the server with a watcher on the configured root
(the user asked for this; plain `pnpm start` never scans). The watcher only
lists folders and asks the OS for change notices: one watch per folder,
symlinks never followed, hidden folders skipped. Changes are batched (4 s of
quiet) into the same incremental scan as `pnpm scan --confirm`, so unchanged
files are not read and the missing-file safeguards apply. The scan writes
through its own database connection; request handlers stay read-only.
Reading files does not trigger change notices, so scans do not loop.

## Configuring the library (do this only at milestone M2.5)

```jsonc
// ~/.config/sonic-archive/config.json
{ "libraryRoot": "/absolute/path/to/Music" }
```

```sh
pnpm scan                                     # shows the plan; reads nothing
pnpm scan --confirm --dry-run                 # lists and compares; reads no contents
pnpm scan --confirm --subpath "Artist/Album"  # sample scan of one folder
```

The first real scan is limited to one or two album folders that you choose
(`--subpath`). A full scan happens only after you approve those results.

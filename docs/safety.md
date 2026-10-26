# Data-safety invariants

These rules come first. Each one names its enforcement and the milestone that
implements it. A rule marked _planned_ is not enforced yet: do not rely on it
until its milestone lands.

| #   | Invariant                                                                                  | Enforcement                                                                                                                                                                                                                                                                                                                                                                                              | Status                                                        |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Original music files are never modified, moved, renamed, deleted, retagged, or transcoded. | All library I/O goes through `fs/library-reader.ts` (list, lstat, parse tags, read a 42-byte header, read cover images). `safety/read-only.test.ts` fails if write APIs, write flags, or process spawning appear in `fs/`, `scanner/` or `metadata/`. Integration tests scan a write-protected fixture copy twice in full mode and compare every file's SHA-256, size, mtime, and mode before and after. | **done (M2)**                                                 |
| 2   | Only the configured library root is ever indexed.                                          | Root comes from the config file or `SONIC_LIBRARY_ROOT` only. `validateLibraryRoot` rejects relative paths, NUL bytes, `/`, `$HOME` and its ancestors (also via symlinks), missing or non-directory roots, and overlap with app directories.                                                                                                                                                             | **done (M0)**: `packages/catalog/src/config/validate-root.ts` |
| 3   | The home directory and other arbitrary directories are never scanned.                      | As #2. The walker never follows symlinks (they are counted and skipped), skips hidden entries, FIFOs and devices, and every file read re-checks containment with `resolveInsideRoot` (realpath).                                                                                                                                                                                                         | **done (M0/M2)**                                              |
| 4   | The real collection is never scanned without explicit authorization.                       | `pnpm start` runs no watcher and no scan. Automatic updates are opt-in by command: `pnpm start:watch` (M14) watches the configured root and runs incremental scans. `pnpm scan` prints its plan and reads nothing without `--confirm`; `--subpath` limits a sample scan to one folder. Under test, both `loadConfig` and `createLibraryReader` refuse any root outside the temp dir or `test-fixtures/`, even if a test injects its own env.                                                                                             | **done (M0/M2)**                                              |
| 5   | Database, cache, and generated data live outside the collection and out of Git.            | XDG directories (`pnpm paths` shows them); overlap with the root is rejected; the database is created only in the data dir and artwork only in the cache dir; `.gitignore` covers `*.db*` and `.data/`.                                                                                                                                                                                                  | **done (M0–M2)**                                              |
| 6   | Localhost only.                                                                            | `main.ts` hard-codes `127.0.0.1` (not configurable). `hostGuard` refuses any `Host` header other than localhost/127.0.0.1/[::1] (DNS rebinding). No CORS headers; `nosniff`, deny-all CSP on API responses, `X-Frame-Options: DENY`.                                                                                                                                                                     | **done (M3)**                                                 |
| 7   | No path traversal or arbitrary filesystem access via the API.                              | No endpoint accepts a path: resources are addressed by numeric id, and strict query schemas reject unknown parameters with 400. Only GET/HEAD are routed. Artwork is served only from the cache dir after its stored name matches `<sha256>.<ext>`.`resolveInsideRoot` guards every library read. The API reads the catalog through a read-only SQLite connection (`query_only`).                        | **done (M2/M3)**                                              |
| 8   | No library data leaves the machine.                                                        | No telemetry, no online metadata lookups, no CDN assets: fonts are bundled from npm. The production web app's CSP allows only same-origin connections. Verified with a headless browser: every page made zero non-local requests.                                                                                                                                                                        | **done (M4)**, ongoing policy                                 |
| 9   | No destructive migrations.                                                                 | Generated SQL is committed after review. A test rejects committed `DROP TABLE`, `ALTER … DROP`, or `DELETE FROM` without a `-- safety-reviewed: <reason>` marker, and the runner refuses to apply such a migration. A `VACUUM INTO` snapshot is taken before migrating any non-empty database, and pending migrations run in one transaction.                                                            | **done (M1)**: `db/migrate.ts`, `db/migration-guard.ts`       |
| 10  | Missing files are reported, not deleted.                                                   | No code path deletes a file row. After a complete, full-scope scan, unseen files get `status = missing`. Scoped, cancelled, failed, or partially unreadable scans never sweep. If 10 or more files and more than 20% of known files would go missing, the scan aborts unless `--allow-mass-missing` is given.                                                                                            | **done (M1/M2)**                                              |

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

# Data-safety invariants

These rules come first. Each one names its enforcement and the milestone that
implements it. A rule marked _planned_ is not enforced yet: do not rely on it
until its milestone lands.

| #   | Invariant                                                                                  | Enforcement                                                                                                                                                                                                                                  | Status                                                        |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Original music files are never modified, moved, renamed, deleted, retagged, or transcoded. | Single read-only library module; a test forbids write-capable `fs` APIs in scanner code; integration tests scan a write-protected fixture copy and compare hashes and mtimes before and after.                                               | planned (M2)                                                  |
| 2   | Only the configured library root is ever indexed.                                          | Root comes from the config file or `SONIC_LIBRARY_ROOT` only. `validateLibraryRoot` rejects relative paths, NUL bytes, `/`, `$HOME` and its ancestors (also via symlinks), missing or non-directory roots, and overlap with app directories. | **done (M0)**: `packages/catalog/src/config/validate-root.ts` |
| 3   | The home directory and other arbitrary directories are never scanned.                      | As #2. The walker will not follow symlinks out of the root.                                                                                                                                                                                  | root rules done (M0); walker planned (M2)                     |
| 4   | The real collection is never scanned without explicit authorization.                       | No watchers and no scan on startup; the scan CLI requires `--confirm`. Under test, `loadConfig` refuses any root outside the temp dir or `test-fixtures/`, even if a test injects its own env.                                               | test sandbox **done (M0)**; CLI gate planned (M2)             |
| 5   | Database, cache, and generated data live outside the collection and out of Git.            | XDG directories (`pnpm paths` shows them); overlap with the root is rejected; `.gitignore` covers `*.db*` and `.data/`.                                                                                                                      | **done (M0)**                                                 |
| 6   | Localhost only.                                                                            | Bind to `127.0.0.1`; `Host` header allowlist; no CORS.                                                                                                                                                                                       | planned (M3)                                                  |
| 7   | No path traversal or arbitrary filesystem access via the API.                              | No endpoint accepts a path; everything is addressed by id; stored paths are re-checked with `resolveInsideRoot`.                                                                                                                             | planned (M2/M3)                                               |
| 8   | No library data leaves the machine.                                                        | No telemetry, no CDN assets, no online metadata lookups.                                                                                                                                                                                     | ongoing policy                                                |
| 9   | No destructive migrations.                                                                 | Reviewed SQL migrations; a test rejects `DROP`/`DELETE` without a `-- safety-reviewed:` marker; DB backup before every migration.                                                                                                            | planned (M1)                                                  |
| 10  | Missing files are reported, not deleted.                                                   | Mark-and-sweep sets `status = missing`; partial or aborted scans never sweep; a mass-missing threshold aborts the scan.                                                                                                                      | planned (M2)                                                  |

## Configuring the library (do this only at milestone M2.5)

```jsonc
// ~/.config/sonic-archive/config.json
{ "libraryRoot": "/absolute/path/to/Music" }
```

The first real scan is limited to one or two album folders that you choose
(`--subpath`). A full scan happens only after you approve those results.

# 0010 — The music folder is chosen in the app

- Status: accepted
- Date: 2026-10-27
- Supersedes parts of: 0002 (root only via config), safety rule #4 (`--confirm` before any scan)

## Context

The app began as one person's catalog, configured by editing
`~/.config/sonic-archive/config.json` and scanning with
`pnpm scan --confirm`. Its owner asked for it to work for anyone, like a
music app: install, choose your music folder, and it keeps itself up to
date.

## Decision

- **First run asks for the folder.** Until one is chosen, every page is a
  setup screen with a folder picker: places (home, ~/Music, mounted drives),
  a list of subfolder names, and a box to paste a path. Browsers cannot hand
  a real path to a local server, so the server lists folders itself
  (`GET /api/folders`, names only).
- **Same validation, wherever the folder comes from.** The chosen path goes
  through `validateLibraryRoot` and is saved to config.json.
  `SONIC_LIBRARY_ROOT` still wins and cannot be changed from the app.
- **Scanning is automatic**: on start, then on changes while watching is on
  (Settings; on by default), and on request. Dynamic range follows. The CLI
  keeps `--confirm`.
- **First write requests**, three of them, guarded against cross-site
  request forgery: same `Origin`, a per-start token readable only by the
  app's page, JSON bodies (docs/safety.md). Request handlers keep a
  read-only database connection; scans write through their own.
- **One folder per installation.** Switching folders rebuilds the catalog
  (derived data only) instead of keeping several catalogs side by side.

## Consequences

- `pnpm start` is all a new user needs; `start:watch` remains as an alias.
- Listing folder names is a new capability of the API; like everything else
  it answers only on 127.0.0.1 behind the Host allowlist.
- Several folders (e.g. an internal disk and an external drive) can come
  later: the schema already allows several roots.

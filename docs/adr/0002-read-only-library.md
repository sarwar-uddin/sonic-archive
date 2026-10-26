# 0002 — The music library is read-only; the app is localhost-only

- Status: accepted
- Date: 2026-10-26

## Context

The collection is irreplaceable. A catalog app has no reason to modify it,
and a bug or a malicious request must not be able to.

## Decision

Treat safety as layered, testable invariants rather than good intentions:

1. The library root is set only in the config file or `SONIC_LIBRARY_ROOT`,
   never through the API. Startup refuses roots that are too broad (`/`, the
   home directory or its ancestors), missing, not a directory, or overlapping
   the app's own directories. Comparisons use canonical (`realpath`) paths.
2. Library I/O goes through a single read-only module. A test forbids
   write-capable `fs` APIs in the scanner. Integration tests scan a
   write-protected copy of the fixtures and assert that every file's hash and
   mtime are unchanged.
3. The API addresses everything by numeric id and never accepts a filesystem
   path. Stored relative paths are re-checked for containment before use.
4. Servers bind to `127.0.0.1` and check the `Host` header to defeat DNS
   rebinding.
5. Nothing is scanned automatically. Scans require an explicit CLI `--confirm`.

See [`../safety.md`](../safety.md) for the full list and where each rule is
enforced.

## Consequences

- Configuring the library is a deliberate act done in a file, not through a
  UI. That is intentional friction.
- Future features that would touch library files (retagging, for example) are
  out of scope unless a new ADR revisits this decision.

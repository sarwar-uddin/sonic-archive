# 0005 — Hand-written SQL read model; Unicode-aware sorting

- Status: accepted
- Date: 2026-10-26

## Context

The API's queries are aggregate-heavy: album summaries with track counts,
duration, codec sets, and max sample rate; artist credit counts; facets.

## Decision

- Writes go through Drizzle's query builder (repositories). Reads use
  hand-written SQL in `packages/catalog/src/read/catalog-queries.ts`, which
  returns the response types from `@sonic-archive/contracts` directly.
  Every value is a bound parameter. The only text spliced into SQL comes from
  fixed allow-lists (sort columns and directions).
- The API opens the database **read-only** (`readonly` plus `query_only`).
  `main.ts` migrates with a separate read-write connection first.
- Search uses an FTS5 table (`track_search`, migration 0001), rebuilt after
  every scan that changes tracks. User input becomes quoted prefix terms
  (`toFtsQuery`), so it can never be read as FTS5 syntax.
- Sorting uses a `sort_key()` SQL function (the same `nameKey` folding as
  artist identity). SQLite's `NOCASE` folds only ASCII, which sorted "Ísold"
  after "Various Artists".

## Consequences

- `sort_key()` runs in JavaScript once per sorted row. That is fine for
  thousands of albums; for 50k-track sorts it costs tens of milliseconds.
  If that ever matters, store a precomputed sort column.
- `remove_diacritics` folds accents but not distinct letters: "æ" is not
  "ae", and "ø" is not "o". Searching "agaetis" does not find "Ágætis".

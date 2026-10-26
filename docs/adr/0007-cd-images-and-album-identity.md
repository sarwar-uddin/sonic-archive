# 0007 — Tracks inside CD images; one album per folder

- Status: accepted
- Date: 2026-10-26

## Context

Many CD rips are single-file images (one FLAC/APE per disc) with an EAC
CUE sheet. Until M7 each showed as one 40-minute track,
because the schema allowed exactly one track per file.

Their sheets also carry ripper-made album titles ("The Wall.50DP361.Japan",
"Ummagumma (CD 1)"). Once those are cleaned, two pressings of one album
(e.g. Master of Puppets, Japanese 32DP 448 and SHM-CD) get the same title,
and with it the same album key: they would merge into one 16-track album.

## Decision

- **A track is a span of a file.** `tracks` gains `segment` (0 = the whole
  file, otherwise the CUE track number), `start_ms` and `end_ms`. The unique
  key moves from `file_id` to `(file_id, segment)`. Migration 0002 is
  additive: existing rows become segment 0 and keep their ids.
- An image is split only when its sheet names it in a FILE line (an exact
  name, or the same name with another extension, since EAC writes the sheet
  for "Album.wav" before compressing it) and lists one file with at least two
  tracks with increasing INDEX 01 times. A lone sheet that names some other
  file still fills album gaps, but never splits.
- A track runs from its INDEX 01 to the next track's INDEX 01 (pregaps
  belong to the previous track, as when the CD plays straight through).
- **Each folder is one release.** The tag-based album key now includes the
  album folder: `tag:<artist>|<title>|<folder>`. Disc folders (`CD1`,
  `Disc 2of2`, `CD 1 (50DP361)`, `(Two)`) count as their parent, so the
  discs of a set still join. MusicBrainz ids still group globally.
- Album titles lose pressing details (catalogue numbers in brackets,
  `.CODE.Country` suffixes, disc markers, a leading copy of the album year).
  Those details stay visible as edition chips from the folder name.
- Album rows left without tracks are deleted after a scan that wrote
  tracks. Albums are derived from tracks; tracks of missing files keep
  theirs, and file rows are still never deleted.

## Consequences

- Sizes are summed over the first track of each file only, and the health
  report compares one audio checksum per file, so an image's tracks are not
  "duplicates" of each other.
- An incremental scan does not notice a CUE sheet added or edited next to an
  unchanged audio file; run `pnpm scan --confirm --full` after such edits.
- The rule change re-keyed every tag-grouped album, so album ids changed
  once (before any user data refers to them). Future user data (ratings,
  notes) must not be keyed on album ids alone if grouping rules may change
  again; see the plan for re-linking.
- Tracks of one album spread over unrelated folders now form separate
  albums. With folder-per-release organisation that is the right answer, and
  the "split albums" health check still covers MusicBrainz-grouped albums.

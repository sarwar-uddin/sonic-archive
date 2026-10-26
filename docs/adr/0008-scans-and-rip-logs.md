# 0008 — Scanned artwork and rip logs: derived at scan, judged at read

- Status: accepted
- Date: 2026-10-26

## Context

Collections often keep CD scans (front, booklet, back, disc, OBI; often
gigabytes of JPEG/PNG/TIFF) and rip logs (EAC, XLD, CUETools) next to the audio.
Both are worth showing. The server must keep reading only the database and
the cache (docs/safety.md), and naming conventions vary from rip to rip.

## Decision

- **The scanner gathers, the server only serves.** After the audio pass,
  the scanner (CLI process) collects each album's images and logs from its
  folder, its disc folders, and subfolders that hold no audio. Images become
  WebP viewing copies of at most 2000 px in the cache (a few percent of
  the originals' size, instead of copying them). Logs are decoded (UTF-16, UTF-8,
  Windows-1251/1252) and stored as text in the database.
- **Interpretation happens at read time.** What an image shows (front,
  booklet page, disc…) and what a log says (verified, clean, differs,
  problems) are computed from the stored names and text when the catalog is
  read. Improving a rule needs no rescan. Album rip verdicts are cached in
  the API process until the set of logs changes.
- **A verdict per album**: per disc the strongest log counts (an EAC log
  plus a CUETools check of the same disc), across discs the weakest.
  "Differs" (no read errors, other AccurateRip checksums) is kept apart from
  "problems", because it usually means another pressing, not a bad rip.
- A folder shared by several albums (loose tracks) gives its images and
  logs to none of them, rather than guessing.

## Consequences

- The first scan after M8 takes a few minutes to render viewing copies;
  later scans reuse them (keyed by source size and mtime).
- Logs in other EAC languages, or new formats, show as `unknown` until a
  rule is added; no rescan is needed once it is.
- Can's _Tago Mago_ and _Live 1972_ share one folder, so their logs are not
  attached to either.

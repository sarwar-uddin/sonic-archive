# Test fixtures

`library/` is a small synthetic music library (about 350 KB) used by the
scanner tests. Every file is generated from sine tones and solid-colour
images by [`generate.sh`](generate.sh). There is no real music here.

The files are committed, so running the tests does not need ffmpeg. To
change the set, edit the script and run `pnpm fixtures:generate`, then update
`FIXTURE_AUDIO_COUNT` in `packages/catalog/src/testing/fixtures.ts` if the
number of visible audio files changed.

| Case                                                                | Where                                     |
| ------------------------------------------------------------------- | ----------------------------------------- |
| FLAC 16/44.1 with embedded cover (shared by two tracks)             | `Aurora Field/Northern Lines (2001)`      |
| FLAC 24/96, ALAC, multi-genre field                                 | `Basalt Quartet/Hi-Res Session (2020)`    |
| WAV, AIFF, MP3, Opus                                                | `Cinder Collective/Format Sampler (2015)` |
| Two discs (`CD1`/`CD2`), MusicBrainz release id                     | `Drift/Double Album (1999)`               |
| Compilation, multi-value ARTIST, composer                           | `Various Artists/Harbour Lights (2010)`   |
| Non-ASCII paths and tags                                            | `Ísold/…`, `Kōji Ensemble/夜明け (2018)`  |
| No tags at all                                                      | `Untagged/unknown.flac`                   |
| Same audio as another file, different tags (equal audio MD5)        | `Duplicates/`                             |
| Not audio despite the `.flac` extension                             | `Broken/garbage.flac`                     |
| Must be skipped: hidden dir, `.DS_Store`, AppleDouble `._*`, `.txt` | various                                   |

Cases created at test time instead: symlinks (inside and escaping the root),
a non-UTF-8 file name, a FIFO, an unreadable folder, and write-protected
copies. DSD (DSF/DFF) is not covered, because ffmpeg cannot encode it.

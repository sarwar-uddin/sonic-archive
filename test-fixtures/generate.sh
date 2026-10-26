#!/usr/bin/env bash
# Generates the synthetic audio library used by the scanner tests.
#
# Everything is created from generated sine tones and solid-colour images:
# no real music is involved. The output is committed, so tests do not need
# ffmpeg; rerun this only when the fixture set must change.
#
# Requires: ffmpeg (flac, alac, libmp3lame, libopus, mjpeg), metaflac.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
out="$here/library"

# Refuse to touch anything other than this script's own fixture directory.
if [[ "$(basename "$here")" != "test-fixtures" || "$out" != "$here/library" ]]; then
  echo "refusing to run outside test-fixtures/" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

rm -rf "$out"
mkdir -p "$out"

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
bitexact=(-fflags +bitexact -flags:a +bitexact)

# tone <freq Hz> <seconds> <sample rate> <ffmpeg sample format> <out> [codec args...]
tone() {
  local freq=$1 secs=$2 rate=$3 fmt=$4 dest=$5
  shift 5
  mkdir -p "$(dirname "$dest")"
  ff -f lavfi -i "sine=frequency=$freq:duration=$secs:sample_rate=$rate" \
    -ac 1 -sample_fmt "$fmt" -map_metadata -1 "${bitexact[@]}" "$@" "$dest"
}

# flac <freq> <seconds> <rate> <bits: 16|24> <out> [TAG=value...]
flac_track() {
  local freq=$1 secs=$2 rate=$3 bits=$4 dest=$5
  shift 5
  local fmt=s16 extra=()
  if [[ $bits == 24 ]]; then fmt=s32 extra=(-bits_per_raw_sample 24); fi
  tone "$freq" "$secs" "$rate" "$fmt" "$dest" -c:a flac "${extra[@]}"
  metaflac --remove-all-tags "$dest"
  local tag
  for tag in "$@"; do metaflac --set-tag="$tag" "$dest"; done
}

cover() { ff -f lavfi -i "color=c=$1:s=64x64" -frames:v 1 -q:v 8 "$2"; }

cover 0x8b2e2e "$work/cover-red.jpg"
cover 0x2e4a8b "$work/cover-blue.jpg"
cover 0x2e8b4a "$work/cover-green.jpg"
cover 0xc9a227 "$work/cover-yellow.jpg"

# --- A plain two-track album, both tracks embedding the same cover --------
album="$out/Aurora Field/Northern Lines (2001)"
flac_track 440 0.5 44100 16 "$album/01 First Light.flac" \
  "TITLE=First Light" "ARTIST=Aurora Field" "ALBUMARTIST=Aurora Field" \
  "ALBUM=Northern Lines" "DATE=2001" "TRACKNUMBER=1" "TRACKTOTAL=2" "GENRE=Ambient"
flac_track 494 0.5 44100 16 "$album/02 Polar Night.flac" \
  "TITLE=Polar Night" "ARTIST=Aurora Field" "ALBUMARTIST=Aurora Field" \
  "ALBUM=Northern Lines" "DATE=2001" "TRACKNUMBER=2" "TRACKTOTAL=2" "GENRE=Ambient"
metaflac --import-picture-from="3||||$work/cover-red.jpg" "$album/01 First Light.flac"
metaflac --import-picture-from="3||||$work/cover-red.jpg" "$album/02 Polar Night.flac"
printf 'Liner notes are not audio and must be skipped.\n' >"$album/notes.txt"
# macOS AppleDouble metadata file: has an audio extension but is not audio.
printf 'Mac OS X        \0\0\0\0' >"$album/._01 First Light.flac"

# --- Hi-res FLAC + ALAC in one album; multi-value genre in one field --------
album="$out/Basalt Quartet/Hi-Res Session (2020)"
flac_track 523 0.25 96000 24 "$album/01 Overture.flac" \
  "TITLE=Overture" "ARTIST=Basalt Quartet" "ALBUMARTIST=Basalt Quartet" \
  "ALBUM=Hi-Res Session" "DATE=2020-03-14" "TRACKNUMBER=1/2" "GENRE=Classical; Chamber"
tone 587 0.5 44100 s16p "$album/02 Coda.m4a" -c:a alac \
  -metadata title=Coda -metadata artist="Basalt Quartet" -metadata album_artist="Basalt Quartet" \
  -metadata album="Hi-Res Session" -metadata date=2020 -metadata track=2/2 -metadata genre=Classical
# Folder art, no embedded art.
cp "$work/cover-green.jpg" "$album/cover.jpg"

# --- Other containers and lossy formats -------------------------------------
album="$out/Cinder Collective/Format Sampler (2015)"
common=(-metadata artist="Cinder Collective" -metadata album_artist="Cinder Collective"
  -metadata album="Format Sampler" -metadata date=2015)
tone 330 0.5 44100 s16 "$album/01 Wave.wav" -c:a pcm_s16le \
  -metadata title=Wave -metadata track=1 "${common[@]}"
tone 349 0.5 44100 s16 "$album/02 Interchange.aiff" -c:a pcm_s16be -write_id3v2 1 \
  -metadata title=Interchange -metadata track=2 "${common[@]}"
tone 392 0.5 44100 s16p "$album/03 Lossy.mp3" -c:a libmp3lame -b:a 128k -id3v2_version 3 \
  -metadata title=Lossy -metadata track=3 "${common[@]}"
tone 415 0.5 48000 s16 "$album/04 Open.opus" -c:a libopus -b:a 64k \
  -metadata title=Open -metadata track=4 "${common[@]}"
# Cover in an art subfolder; back.jpg must never be chosen.
mkdir -p "$album/Artwork"
ff -f lavfi -i "color=c=0x6a2e8b:s=64x64" -frames:v 1 "$album/Artwork/Front.png"
cp "$work/cover-red.jpg" "$album/back.jpg"

# --- Two discs, identified by a MusicBrainz release id ----------------------
album="$out/Drift/Double Album (1999)"
mbid=11111111-2222-4333-8444-555555555555
flac_track 262 0.5 44100 16 "$album/CD1/01 Side A.flac" \
  "TITLE=Side A" "ARTIST=Drift" "ALBUMARTIST=Drift" "ALBUM=Double Album" "DATE=1999" \
  "TRACKNUMBER=1" "DISCNUMBER=1" "DISCTOTAL=2" "MUSICBRAINZ_ALBUMID=$mbid"
flac_track 294 0.5 44100 16 "$album/CD2/01 Side C.flac" \
  "TITLE=Side C" "ARTIST=Drift" "ALBUMARTIST=Drift" "ALBUM=Double Album" "DATE=1999" \
  "TRACKNUMBER=1" "DISCNUMBER=2" "DISCTOTAL=2" "MUSICBRAINZ_ALBUMID=$mbid"
metaflac --import-picture-from="3||||$work/cover-blue.jpg" "$album/CD1/01 Side A.flac"
# Album-level folder art above the disc folders wins over the embedded cover.
cp "$work/cover-yellow.jpg" "$album/folder.jpg"

# --- Compilation: several artists, multi-value ARTIST, a composer -----------
album="$out/Various Artists/Harbour Lights (2010)"
flac_track 659 0.5 44100 16 "$album/01 Signal.flac" \
  "TITLE=Signal" "ARTIST=Aurora Field" "ALBUMARTIST=Various Artists" \
  "ALBUM=Harbour Lights" "DATE=2010" "TRACKNUMBER=1" "COMPILATION=1"
flac_track 698 0.5 44100 16 "$album/02 Duet.flac" \
  "TITLE=Duet" "ARTIST=Echo Park" "ARTIST=Fen Lowe" "ALBUMARTIST=Various Artists" \
  "ALBUM=Harbour Lights" "DATE=2010" "TRACKNUMBER=2" "COMPILATION=1" "COMPOSER=Gil Moreno"

# --- Non-ASCII names in paths and tags --------------------------------------
flac_track 740 0.5 44100 16 "$out/Ísold/Ágætis Morgunn (2005)/01 Svefn.flac" \
  "TITLE=Svefn" "ARTIST=Ísold" "ALBUMARTIST=Ísold" "ALBUM=Ágætis Morgunn" "DATE=2005" \
  "TRACKNUMBER=1"
flac_track 784 0.5 44100 16 "$out/Kōji Ensemble/夜明け (2018)/01 光.flac" \
  "TITLE=光" "ARTIST=Kōji Ensemble" "ALBUMARTIST=Kōji Ensemble" "ALBUM=夜明け" "DATE=2018" \
  "TRACKNUMBER=1"

# --- Two single-file CD images with CUE sheets ------------------------------
# Untagged, as EAC leaves them: album and track details live only in the
# sheets. The sheets name "*.wav" (written before compression), and the disc
# titles carry disc markers and a catalogue suffix that must not split the set.
album="$out/Ember/Live Image (2010)"
flac_track 220 3 44100 16 "$album/CD1/Ember - Live Image.flac"
printf '%s\r\n' 'REM GENRE "Post-Rock"' 'REM DATE 2010' 'PERFORMER "Ember"' \
  'TITLE "Live Image (CD 1)"' 'FILE "Ember - Live Image.wav" WAVE' \
  '  TRACK 01 AUDIO' '    TITLE "Kindling"' '    INDEX 01 00:00:00' \
  '  TRACK 02 AUDIO' '    TITLE "Smoke"' '    INDEX 00 00:00:70' '    INDEX 01 00:01:00' \
  '  TRACK 03 AUDIO' '    TITLE "Ash"' '    PERFORMER "Ember feat. Wren"' '    INDEX 01 00:02:00' \
  >"$album/CD1/Ember - Live Image.wav.cue"
flac_track 247 2 44100 16 "$album/CD2/Ember - Live Image 2.flac"
printf '%s\r\n' 'REM DATE 2010' 'PERFORMER "Ember"' 'TITLE "Live Image.TEST-102.Japan"' \
  'FILE "Ember - Live Image 2.flac" WAVE' \
  '  TRACK 01 AUDIO' '    TITLE "Embers"' '    INDEX 01 00:00:00' \
  '  TRACK 02 AUDIO' '    TITLE "Daybreak"' '    INDEX 01 00:01:00' \
  >"$album/CD2/Ember - Live Image 2.cue"

# Rip logs, as EAC (UTF-16 with BOM) and CUETools write them. Disc 1 matches
# AccurateRip; disc 2's checksums differ (another pressing). Alternate-offset
# matches after "Offsetted by" must not count. AUDIOCHECKER output is not a
# rip log and must be ignored.
{
  printf '\xff\xfe'
  printf '%s\r\n' 'Exact Audio Copy V1.8 from 15. July 2024' '' \
    'EAC extraction logfile from 4. May 2025, 18:21' '' 'Ember / Live Image (CD 1)' '' \
    'Used drive  : TEST DRIVE   Adapter: 1  ID: 0' '' 'Read mode               : Secure' \
    'Read offset correction                      : 6' '' 'Range status and errors' '' \
    '     Test CRC 06E6CCC8' '     Copy CRC 06E6CCC8' '     Copy OK' '' 'No errors occurred' '' \
    'AccurateRip summary' '' \
    'Track  1  accurately ripped (confidence 12)  [401DC439]  (AR v2)' \
    'Track  2  accurately ripped (confidence 9)  [669A874E]  (AR v2)' \
    'Track  3  accurately ripped (confidence 12)  [663AD2EE]  (AR v2)' '' \
    'All tracks accurately ripped' '' 'End of status report' '' \
    '==== Log checksum 6887976A3EDBFB0540F56A5A9BEC5AFED4CBD1F36EAAACD7070DD697FF40649C ====' |
    iconv -f UTF-8 -t UTF-16LE
} >"$album/CD1/Ember - Live Image.log"
printf '%s\r\n' '[CUETools log; Date: 26.08.2019 12:10:38; Version: 2.1.6]' \
  '[AccurateRip ID: 0001f2a3-000b4c5d-0e0f1a2b] found.' 'Track   [  CRC   |   V2   ] Status' \
  ' 01     [64ecdb9f|22ba4f84] (000/12) No match' ' 02     [e6b2dadf|2e88fe21] (000/12) No match' \
  'Offsetted by 48:' ' 01     [8ccafa41] (010/12) Accurately ripped' \
  ' 02     [48a087dd] (010/12) Accurately ripped' \
  >"$album/CD2/Ember - Live Image 2.accurip"
printf '%s\r\n' 'AUDIOCHECKER v2.0 beta (build 457) - by Dester - official page: dester.ru' \
  'CDDA 100%' >"$album/CD1/audiochecker.log"

# --- Problem files ----------------------------------------------------------
# No tags at all.
flac_track 831 0.5 44100 16 "$out/Untagged/unknown.flac"
# Same audio as "01 First Light" with different tags: identical audio MD5.
flac_track 440 0.5 44100 16 "$out/Duplicates/First Light (copy).flac" \
  "TITLE=First Light (copy)" "ARTIST=Aurora Field" "ALBUM=Loose Copies"
# An audio extension on bytes that are not audio.
mkdir -p "$out/Broken"
printf 'This is not a FLAC stream.\n' >"$out/Broken/garbage.flac"
# Hidden files and directories must be skipped.
flac_track 880 0.5 44100 16 "$out/.hidden/secret.flac" "TITLE=Secret"
printf '\0\0\0\1Bud1' >"$out/.DS_Store"

echo "fixtures written to $out"
find "$out" -type f | wc -l
du -sh "$out"

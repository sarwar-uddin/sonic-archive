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

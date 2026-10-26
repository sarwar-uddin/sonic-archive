import type { Disc, TrackSummary } from '@sonic-archive/contracts';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import {
  formatBitrate,
  formatBytes,
  formatDuration,
  formatResolution,
  formatSpec,
  isHiRes,
} from '../lib/format.ts';
import styles from './TrackList.module.css';

interface TrackListProps {
  readonly discs: readonly Disc[];
  /** Hide per-track artists that just repeat the album artist. */
  readonly albumArtist: string | null;
}

/** A back-sleeve style track listing, grouped by disc when there are several. */
export function TrackList({ discs, albumArtist }: TrackListProps) {
  const multiDisc = discs.length > 1;
  return (
    <div className={styles.listing}>
      {discs.map((disc) => (
        <section key={disc.discNo ?? 'none'} aria-label={multiDisc ? discLabel(disc) : 'Tracks'}>
          {multiDisc && <h3 className={styles.disc}>{discLabel(disc)}</h3>}
          <ol className={styles.tracks}>
            {disc.tracks.map((track) => (
              <TrackRow key={track.id} track={track} albumArtist={albumArtist} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function discLabel(disc: Disc): string {
  return disc.discNo === null ? 'Other tracks' : `Disc ${disc.discNo}`;
}

function TrackRow({ track, albumArtist }: { track: TrackSummary; albumArtist: string | null }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const showArtist = track.displayArtist !== null && track.displayArtist !== albumArtist;
  const unavailable = track.file.status !== 'present';

  return (
    <li className={`${styles.row} ${unavailable ? styles.unavailable : ''}`}>
      <button
        type="button"
        className={styles.summary}
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`mono ${styles.number}`}>{track.trackNo ?? '·'}</span>
        <span className={styles.titleCell}>
          <span className={styles.title}>{track.title ?? fileName(track.file.relPath)}</span>
          {showArtist && <span className={styles.artist}>{track.displayArtist}</span>}
          {unavailable && (
            <span className={styles.status}>
              {track.file.status === 'missing' ? 'Missing' : 'Unreadable'}
            </span>
          )}
        </span>
        <span
          className={`mono ${styles.resolution} ${isHiRes(track.bitDepth, track.sampleRate) ? styles.hiRes : ''}`}
        >
          {formatResolution(track.bitDepth, track.sampleRate)}
        </span>
        <span className={`mono ${styles.duration}`}>{formatDuration(track.durationMs)}</span>
      </button>
      <div id={detailsId} hidden={!open} className={styles.details}>
        <dl className={styles.spec}>
          <dt>Format</dt>
          <dd>{formatSpec(track)}</dd>
          <dt>Container</dt>
          <dd>{track.container ?? '—'}</dd>
          <dt>Bitrate</dt>
          <dd>{formatBitrate(track.bitrate)}</dd>
          {track.span && (
            <>
              <dt>Position</dt>
              <dd>
                {formatDuration(track.span.startMs)} –{' '}
                {track.span.endMs === null ? 'end' : formatDuration(track.span.endMs)} of the CD
                image, by its CUE sheet
              </dd>
            </>
          )}
          <dt>{track.span ? 'Image size' : 'File size'}</dt>
          <dd>{formatBytes(track.file.size)}</dd>
          {track.artists.length > 0 && (
            <>
              <dt>Credits</dt>
              <dd>
                {track.artists.map((artist, i) => (
                  <span key={artist.id}>
                    {i > 0 && ', '}
                    <Link to={`/artists/${artist.id}`}>{artist.name}</Link>
                  </span>
                ))}
              </dd>
            </>
          )}
          <dt>Audio MD5</dt>
          <dd className={styles.wrap}>{track.file.audioMd5 ?? 'not recorded by this format'}</dd>
          <dt>File</dt>
          <dd className={styles.wrap}>{track.file.relPath}</dd>
        </dl>
      </div>
    </li>
  );
}

function fileName(relPath: string): string {
  return relPath.split('/').at(-1) ?? relPath;
}

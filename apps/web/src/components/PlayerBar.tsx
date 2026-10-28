import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { formatDuration } from '../lib/format.ts';
import { usePlayer } from '../lib/use-player.tsx';
import { Cover } from './Cover.tsx';
import styles from './PlayerBar.module.css';

/** Shown once something has been played: what is on, and the transport. */
export function PlayerBar() {
  const [state, player] = usePlayer();
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal) });
  const item = state.queue[state.index];
  if (!item) return null;
  const length = item.durationMs ?? 0;
  const hasNext = state.index < state.queue.length - 1;

  return (
    <section className={styles.bar} aria-label="Player">
      <div className={styles.now}>
        <span className={styles.sleeve}>
          <Cover
            artworkId={item.artworkId}
            title={item.albumTitle ?? item.title}
            artist={item.artist}
          />
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{item.title}</span>
          <span className={styles.meta}>
            {item.artist}
            {item.albumId !== null && (
              <>
                {item.artist ? ' — ' : ''}
                <Link to={`/albums/${item.albumId}`}>{item.albumTitle}</Link>
              </>
            )}
          </span>
          {state.failed && (
            <span className={styles.error} role="alert">
              {item.playback === 'transcode' && health.data?.transcoding === false
                ? 'This format needs ffmpeg to play. Install it and restart Sonic Archive.'
                : 'This track could not be played.'}
            </span>
          )}
        </span>
      </div>

      <div className={styles.transport}>
        <div className={styles.buttons}>
          <button type="button" onClick={() => player.previous()} aria-label="Previous track">
            <Icon d="M6 5h2v14H6zM20 5v14L9 12z" />
          </button>
          <button
            type="button"
            className={styles.play}
            onClick={() => player.toggle()}
            aria-label={state.playing ? 'Pause' : 'Play'}
          >
            {state.playing ? <Icon d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <Icon d="M8 5v14l11-7z" />}
          </button>
          <button
            type="button"
            onClick={() => player.next()}
            disabled={!hasNext}
            aria-label="Next track"
          >
            <Icon d="M16 5h2v14h-2zM4 5v14l11-7z" />
          </button>
        </div>
        <div className={styles.seek}>
          <span className="mono">{formatDuration(state.positionMs)}</span>
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={Math.max(1, length)}
            step={1000}
            value={Math.min(state.positionMs, length)}
            aria-valuetext={`${formatDuration(state.positionMs)} of ${formatDuration(length)}`}
            onChange={(event) => player.seek(Number(event.target.value))}
            style={
              {
                '--fill': `${length ? (state.positionMs / length) * 100 : 0}%`,
              } as React.CSSProperties
            }
          />
          <span className="mono">{formatDuration(length)}</span>
        </div>
      </div>

      <div className={styles.side}>
        <span className={`mono ${styles.count}`}>
          {state.index + 1} / {state.queue.length}
        </span>
        <input
          type="range"
          className={styles.volume}
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={state.volume}
          onChange={(event) => player.setVolume(Number(event.target.value))}
          style={{ '--fill': `${state.volume * 100}%` } as React.CSSProperties}
        />
      </div>
    </section>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

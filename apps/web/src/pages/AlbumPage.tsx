import type { AlbumDetail } from '@sonic-archive/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { editionText } from '../components/AlbumGrid.tsx';
import { Cover } from '../components/Cover.tsx';
import { Pressings } from '../components/Pressings.tsx';
import { RipLogs } from '../components/RipLogs.tsx';
import { ScanShelf } from '../components/ScanViewer.tsx';
import { ErrorMessage, Loading } from '../components/States.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { api, artworkUrl } from '../lib/api.ts';
import {
  formatBytes,
  formatLongDuration,
  formatResolution,
  formatSampleRate,
  isHiRes,
  plural,
  shortCodec,
} from '../lib/format.ts';
import { toQueueItem } from '../lib/player.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import { usePlayer } from '../lib/use-player.tsx';
import styles from './AlbumPage.module.css';
import { NotFoundPage } from './NotFoundPage.tsx';

export function AlbumPage() {
  const id = Number(useParams().id);
  const album = useQuery({
    queryKey: ['album', id],
    queryFn: ({ signal }) => api.album(id, signal),
    enabled: Number.isInteger(id) && id > 0,
  });
  useDocumentTitle(album.data?.title);

  if (!Number.isInteger(id) || id <= 0) return <NotFoundPage />;
  if (album.isPending) return <Loading label="Taking it off the shelf" />;
  if (album.isError) {
    if ((album.error as { status?: number }).status === 404) return <NotFoundPage />;
    return <ErrorMessage error={album.error} retry={() => album.refetch()} />;
  }
  return <AlbumView album={album.data} />;
}

export function AlbumView({ album }: { readonly album: AlbumDetail }) {
  const artist = album.albumArtist?.name ?? null;
  const format = `${album.codecs.map(shortCodec).join('+') || '—'} ${formatResolution(album.maxBitDepth, album.maxSampleRate)}`;
  const hiRes = isHiRes(album.maxBitDepth, album.maxSampleRate);

  // Disc folders give disc numbers even when no tag says how many discs.
  const discCount = Math.max(
    album.totalDiscs ?? 0,
    album.discs.filter((d) => d.discNo !== null).length,
  );
  const fromImage = album.discs.some((d) => d.tracks.some((t) => t.span !== null));

  const [playerState, player] = usePlayer();
  const playable = album.discs.flatMap((d) => d.tracks).filter((t) => t.file.status === 'present');
  const queue = playable.map((t) =>
    toQueueItem(t, { id: album.id, title: album.title, artworkId: album.artworkId }),
  );
  const playFrom = (trackId: number) =>
    player.play(
      queue,
      Math.max(
        0,
        queue.findIndex((q) => q.trackId === trackId),
      ),
    );
  const currentItem = playerState.queue[playerState.index];
  const nowPlaying =
    currentItem && currentItem.albumId === album.id
      ? { trackId: currentItem.trackId, playing: playerState.playing }
      : null;

  return (
    <article>
      <header className={styles.hero}>
        {album.artworkId !== null && (
          <img
            className={styles.backdrop}
            src={artworkUrl(album.artworkId, 'sm')}
            alt=""
            aria-hidden="true"
          />
        )}
        <div className={styles.heroInner}>
          <div className={styles.sleeve}>
            <Cover
              artworkId={album.artworkId}
              title={album.title}
              artist={artist}
              size="lg"
              eager
            />
            <Obi artist={artist} title={album.title} format={format} year={album.year} />
          </div>
          <div className={styles.heading}>
            <p className="kicker">
              {album.kind === 'release' ? 'Release' : 'Loose tracks'}
              {album.year ? ` · ${album.year}` : ''}
            </p>
            <h1 className={styles.title}>{album.title}</h1>
            <p className={styles.artist}>
              {album.albumArtist ? (
                <Link to={`/artists/${album.albumArtist.id}`}>{album.albumArtist.name}</Link>
              ) : (
                'Unknown artist'
              )}
            </p>
            {album.edition.length > 0 && (
              <ul className={styles.edition} aria-label="Pressing">
                {editionText(album.edition, album.year)
                  .split(' · ')
                  .map((e) => (
                    <li key={e} className="mono">
                      {e}
                    </li>
                  ))}
              </ul>
            )}
            {queue.length > 0 && (
              <p className={styles.actions}>
                <button
                  type="button"
                  className={styles.playAlbum}
                  onClick={() => (nowPlaying ? player.toggle() : player.play(queue, 0))}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      d={nowPlaying?.playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z'}
                      fill="currentColor"
                    />
                  </svg>
                  {nowPlaying?.playing ? 'Pause' : nowPlaying ? 'Resume' : 'Play album'}
                </button>
              </p>
            )}
            <p className={`mono ${styles.facts}`}>
              <span className={`tag ${hiRes ? 'tag-hires' : ''}`}>{format}</span>
              <span>{plural(album.trackCount, 'track')}</span>
              <span>{formatLongDuration(album.durationMs)}</span>
              <span>{formatBytes(album.totalBytes)}</span>
              {album.dr !== null && (
                <span className="tag" title="Dynamic range (DR meter)">
                  DR{album.dr}
                </span>
              )}
            </p>
            {album.genres.length > 0 && (
              <ul className={styles.genres} aria-label="Genres">
                {album.genres.map((genre) => (
                  <li key={genre.id}>
                    <Link to={`/?genre=${genre.id}&kind=all`}>{genre.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </header>

      {album.otherPressings.length > 0 && (
        <section className={styles.scans} aria-labelledby="pressings-heading">
          <h2 id="pressings-heading" className={styles.sectionTitle}>
            Pressings in your collection
          </h2>
          <Pressings album={album} />
        </section>
      )}

      {album.scans.length > 0 && (
        <section className={styles.scans} aria-labelledby="scans-heading">
          <h2 id="scans-heading" className={styles.sectionTitle}>
            Sleeve &amp; booklet
          </h2>
          <ScanShelf scans={album.scans} title={album.title} />
        </section>
      )}

      <div className={styles.body}>
        <section aria-labelledby="tracklist-heading">
          <h2 id="tracklist-heading" className={styles.sectionTitle}>
            Tracklist
          </h2>
          <TrackList
            discs={album.discs}
            albumArtist={artist}
            onPlay={(track) => playFrom(track.id)}
            nowPlaying={nowPlaying}
          />
        </section>

        <aside className={styles.specSheet} aria-labelledby="spec-heading">
          <h2 id="spec-heading" className="kicker">
            Specification
          </h2>
          <dl>
            <Spec label="Format">{album.codecs.map(shortCodec).join(', ') || '—'}</Spec>
            <Spec label="Resolution">
              {album.maxBitDepth ? `${album.maxBitDepth} bit / ` : ''}
              {formatSampleRate(album.maxSampleRate)}
            </Spec>
            <Spec label="Fidelity">{album.lossless ? 'Lossless' : 'Contains lossy tracks'}</Spec>
            <Spec label="Tracks">
              {plural(album.trackCount, 'track')}
              {discCount > 1 ? ` on ${discCount} discs` : ''}
            </Spec>
            {fromImage && <Spec label="Rip">Single-file CD image, split by CUE sheet</Spec>}
            <Spec label="Running time">{formatLongDuration(album.durationMs)}</Spec>
            <Spec label="Size">{formatBytes(album.totalBytes)}</Spec>
            {album.dr !== null && (
              <Spec label="Dynamic range">
                <abbr title="Measured with the DR meter: higher is more dynamic, under 8 is heavily compressed">
                  DR{album.dr}
                </abbr>
              </Spec>
            )}
            {album.edition.length > 0 && <Spec label="Pressing">{album.edition.join(' · ')}</Spec>}
            {album.musicbrainzAlbumId && (
              <Spec label="MusicBrainz">
                <span className={styles.wrap}>{album.musicbrainzAlbumId}</span>
              </Spec>
            )}
          </dl>
          {album.rip !== null && album.ripLogs.length > 0 && (
            <section aria-labelledby="rip-heading">
              <h3 id="rip-heading" className="visually-hidden">
                Rip log
              </h3>
              <RipLogs logs={album.ripLogs} verdict={album.rip} />
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.specRow}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A decorative OBI strip, the paper band wrapped around Japanese CD and LP
 * sleeves: artist and title set vertically, the format on a red block.
 * Everything on it is repeated in the page text, so it is hidden from
 * assistive technology.
 */
function Obi({
  artist,
  title,
  format,
  year,
}: {
  artist: string | null;
  title: string;
  format: string;
  year: number | null;
}) {
  return (
    <div className={styles.obi} aria-hidden="true">
      <span className={styles.obiBand}>{format}</span>
      <span className={styles.obiText}>
        <strong>{artist ?? 'Unknown artist'}</strong>
        <span>{title}</span>
      </span>
      <span className={`mono ${styles.obiFoot}`}>{year ?? '—'}</span>
    </div>
  );
}

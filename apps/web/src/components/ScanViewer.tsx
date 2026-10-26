import type { AlbumScan, ScanKind } from '@sonic-archive/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { artworkUrl } from '../lib/api.ts';
import styles from './ScanViewer.module.css';

const KIND_LABELS: Record<ScanKind, string> = {
  front: 'Front',
  booklet: 'Booklet',
  inside: 'Inside',
  back: 'Back',
  tray: 'Tray',
  disc: 'Disc',
  obi: 'OBI',
  extra: 'Extras',
  spectrogram: 'Rip checks',
};

/**
 * "Booklet · page 3 of 20", "Back", "Disc · 2 of 4": what one scan shows.
 * Counted by position, since scanners number pages from 0 or 1 alike.
 */
export function scanCaption(scan: AlbumScan, position: number, sameKind: number): string {
  const kind = KIND_LABELS[scan.kind];
  if (sameKind < 2) return kind;
  return scan.kind === 'booklet'
    ? `${kind} · page ${position} of ${sameKind}`
    : `${kind} · ${position} of ${sameKind}`;
}

interface ScanShelfProps {
  readonly scans: readonly AlbumScan[];
  readonly title: string;
}

/**
 * The album's scanned artwork as a strip of thumbnails, grouped the way you
 * would leaf through the case, opening a full-screen viewer.
 */
export function ScanShelf({ scans, title }: ScanShelfProps) {
  const [open, setOpen] = useState<number | null>(null);
  const counts = new Map<ScanKind, number>();
  const positions = new Map<AlbumScan, number>();
  for (const scan of scans) {
    const n = (counts.get(scan.kind) ?? 0) + 1;
    counts.set(scan.kind, n);
    positions.set(scan, n);
  }
  const caption = (scan: AlbumScan) =>
    scanCaption(scan, positions.get(scan) ?? 1, counts.get(scan.kind) ?? 0);

  const groups: { kind: ScanKind; items: { scan: AlbumScan; index: number }[] }[] = [];
  scans.forEach((scan, index) => {
    const last = groups.at(-1);
    if (last?.kind === scan.kind) last.items.push({ scan, index });
    else groups.push({ kind: scan.kind, items: [{ scan, index }] });
  });

  return (
    <>
      <div className={styles.shelf}>
        {groups.map((group) => (
          <section key={group.kind} className={styles.group} aria-label={KIND_LABELS[group.kind]}>
            <h3 className="kicker">
              {KIND_LABELS[group.kind]}
              {group.items.length > 1 && <span className="mono"> {group.items.length}</span>}
            </h3>
            <ul className={styles.thumbs}>
              {group.items.map(({ scan, index }) => (
                <li key={scan.artworkId + scan.label}>
                  <button
                    type="button"
                    className={styles.thumb}
                    onClick={() => setOpen(index)}
                    aria-label={`View ${caption(scan)}`}
                  >
                    <img
                      src={artworkUrl(scan.artworkId, 'sm')}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={scan.width ?? undefined}
                      height={scan.height ?? undefined}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {open !== null && (
        <ScanDialog
          scans={scans}
          index={open}
          title={title}
          caption={caption}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

interface ScanDialogProps {
  readonly scans: readonly AlbumScan[];
  readonly index: number;
  readonly title: string;
  readonly caption: (scan: AlbumScan) => string;
  readonly onIndex: (index: number) => void;
  readonly onClose: () => void;
}

/**
 * Full-screen viewer. Arrow keys page through the scans, Escape closes, and
 * clicking the image switches between fitting the screen and full size
 * (scroll to pan), for reading liner notes.
 */
function ScanDialog({ scans, index, title, caption, onIndex, onClose }: ScanDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const scan = scans[index] as AlbumScan;
  const go = useCallback(
    (step: number) => {
      const next = index + step;
      if (next >= 0 && next < scans.length) {
        onIndex(next);
        setZoomed(false);
      }
    },
    [index, scans.length, onIndex],
  );

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // A modal <dialog> traps focus and closes on Escape by itself.
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
    };
  }, []);

  // Listen on the window: focus may be anywhere while the viewer is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') go(1);
      else if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // Fetch the neighbours ahead of time so paging feels instant.
  useEffect(() => {
    for (const neighbour of [scans[index - 1], scans[index + 1]]) {
      if (neighbour) new Image().src = artworkUrl(neighbour.artworkId, 'xl');
    }
  }, [index, scans]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={`${title}: scanned artwork`}
      onClose={onClose}
    >
      <header className={styles.bar}>
        <p>
          <strong>{caption(scan)}</strong>
          <span className="mono">
            {' '}
            {index + 1} / {scans.length}
          </span>
        </p>
        <p className={`mono ${styles.file}`}>{scan.label}</p>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </header>
      <div className={`${styles.stage} ${zoomed ? styles.zoomed : ''}`}>
        <button
          type="button"
          className={styles.imageButton}
          onClick={() => setZoomed((z) => !z)}
          aria-label={zoomed ? 'Fit to screen' : 'Show full size'}
        >
          <img
            key={scan.artworkId}
            src={artworkUrl(scan.artworkId, 'xl')}
            alt={caption(scan)}
            width={scan.width ?? undefined}
            height={scan.height ?? undefined}
          />
        </button>
      </div>
      <button
        type="button"
        className={`${styles.nav} ${styles.prev}`}
        onClick={() => go(-1)}
        disabled={index === 0}
        aria-label="Previous scan"
      >
        ‹
      </button>
      <button
        type="button"
        className={`${styles.nav} ${styles.next}`}
        onClick={() => go(1)}
        disabled={index === scans.length - 1}
        aria-label="Next scan"
      >
        ›
      </button>
      <ol className={styles.rail} aria-label="All scans">
        {scans.map((s, i) => (
          <li key={s.artworkId + s.label}>
            <button
              type="button"
              aria-current={i === index ? 'true' : undefined}
              aria-label={caption(s)}
              onClick={() => go(i - index)}
            >
              <img src={artworkUrl(s.artworkId, 'sm')} alt="" loading="lazy" />
            </button>
          </li>
        ))}
      </ol>
    </dialog>
  );
}

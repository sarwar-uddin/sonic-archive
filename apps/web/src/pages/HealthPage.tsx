import type { HealthTrackRef, ReportSection } from '@sonic-archive/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { RipStamp } from '../components/RipLogs.tsx';
import { ErrorMessage, Loading } from '../components/States.tsx';
import { api } from '../lib/api.ts';
import { formatDuration } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './HealthPage.module.css';
import page from './page.module.css';

/** Library health: what needs attention, without changing anything. */
export function HealthPage() {
  useDocumentTitle('Health');
  const report = useQuery({
    queryKey: ['health-report'],
    queryFn: ({ signal }) => api.healthReport(signal),
  });

  if (report.isPending) return <Loading label="Inspecting the shelves" />;
  if (report.isError) return <ErrorMessage error={report.error} retry={() => report.refetch()} />;
  const r = report.data;

  const summary = [
    ['Missing files', r.missingFiles.total, 'missing'],
    ['Unreadable files', r.unreadableFiles.total, 'unreadable'],
    ['Metadata issues', r.metadataIssues.total, 'metadata'],
    ['Without artwork', r.missingArtwork.total, 'artwork'],
    ['Exact duplicates', r.exactDuplicates.total, 'exact'],
    ['Probable duplicates', r.probableDuplicates.total, 'probable'],
    ['Split albums', r.splitAlbums.total, 'split'],
    ['Rip checks', r.ripChecks.total, 'rips'],
  ] as const;

  return (
    <>
      <header className={page.header}>
        <div className={page.headline}>
          <p className="kicker">Library health</p>
          <h1 className={page.title}>
            What needs <em>attention.</em>
          </h1>
          <p className={styles.lede}>
            A read-only report. Sonic Archive never changes your files; fix problems in your tagger,
            then rescan.
          </p>
        </div>
      </header>

      <nav aria-label="Report sections" className={styles.summary}>
        {summary.map(([label, count, id]) => (
          <a key={id} href={`#${id}`} className={count > 0 ? styles.attention : styles.clear}>
            <span className={styles.count}>{count.toLocaleString('en')}</span>
            <span className="kicker">{label}</span>
          </a>
        ))}
      </nav>

      <Section
        id="missing"
        title="Missing files"
        data={r.missingFiles}
        empty="Every catalogued file is where it was."
      >
        {(f) => (
          <li key={f.relPath}>
            <Path>{f.relPath}</Path>
            {f.missingSince && (
              <span className="mono">since {new Date(f.missingSince).toLocaleDateString()}</span>
            )}
          </li>
        )}
      </Section>

      <Section
        id="unreadable"
        title="Unreadable files"
        data={r.unreadableFiles}
        empty="Every audio file could be read."
      >
        {(f) => (
          <li key={f.relPath}>
            <Path>{f.relPath}</Path>
            <span className={styles.note}>{f.error}</span>
          </li>
        )}
      </Section>

      <Section
        id="metadata"
        title="Metadata issues"
        data={r.metadataIssues}
        empty="No tagging problems found."
      >
        {(a) => (
          <li key={a.album.id}>
            <AlbumLink album={a.album} />
            <ul className={styles.issues}>
              {a.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </li>
        )}
      </Section>

      <Section
        id="artwork"
        title="Without artwork"
        data={r.missingArtwork}
        empty="Every album has a cover."
      >
        {(a) => (
          <li key={a.id}>
            <AlbumLink album={a} />
          </li>
        )}
      </Section>

      <Section
        id="exact"
        title="Exact duplicates"
        data={r.exactDuplicates}
        empty="No bit-identical audio found."
        note="Bit-identical decoded audio (same FLAC audio MD5), whatever the tags or file names say."
      >
        {(group) => (
          <li key={group.audioMd5}>
            <span className="mono">{group.audioMd5}</span>
            <TrackRefs tracks={group.tracks} />
          </li>
        )}
      </Section>

      <Section
        id="probable"
        title="Probable duplicates"
        data={r.probableDuplicates}
        empty="No likely duplicates found."
        note="Same artist and title, durations within two seconds: often the same recording in another format or edition."
      >
        {(group) => (
          <li key={group.tracks.map((t) => t.trackId).join('-')}>
            <TrackRefs tracks={group.tracks} />
          </li>
        )}
      </Section>

      <Section
        id="split"
        title="Split albums"
        data={r.splitAlbums}
        empty="No album is spread across unrelated folders."
        note="One album tag found in several unrelated folders: a duplicate copy, or two different releases sharing a name."
      >
        {(s) => (
          <li key={s.album.id}>
            <AlbumLink album={s.album} />
            <ul className={styles.issues}>
              {s.folders.map((folder) => (
                <li key={folder}>
                  <Path>{folder}</Path>
                </li>
              ))}
            </ul>
          </li>
        )}
      </Section>

      <Section
        id="rips"
        title="Rip checks"
        data={r.ripChecks}
        empty="Every rip log is clean or verified."
        note="From the EAC, XLD and CUETools logs next to your rips. “Differs” usually means AccurateRip only knows another pressing with the same track layout; “problems” means the ripper reported read errors."
      >
        {(c) => (
          <li key={c.album.id}>
            <AlbumLink album={c.album} />
            <RipStamp verdict={c.verdict} />
            <ul className={styles.issues}>
              {c.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </li>
        )}
      </Section>
    </>
  );
}

function Section<T>({
  id,
  title,
  data,
  empty,
  note,
  children,
}: {
  id: string;
  title: string;
  data: ReportSection<T>;
  empty: string;
  note?: string;
  children: (item: T) => ReactNode;
}) {
  return (
    <section id={id} className={`${page.section} ${styles.section}`} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={page.sectionTitle}>
        {title} <span className={page.count}>{data.total.toLocaleString('en')}</span>
      </h2>
      {note && <p className={styles.note}>{note}</p>}
      {data.total === 0 ? (
        <p className={styles.ok}>{empty}</p>
      ) : (
        <>
          <ul className={styles.list}>{data.items.map(children)}</ul>
          {data.total > data.items.length && (
            <p className={styles.note}>
              Showing the first {data.items.length} of {data.total.toLocaleString('en')}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function AlbumLink({ album }: { album: { id: number; title: string; artist?: string | null } }) {
  return (
    <span className={styles.album}>
      <Link to={`/albums/${album.id}`}>{album.title}</Link>
      {album.artist && <span className={styles.artist}> — {album.artist}</span>}
    </span>
  );
}

function TrackRefs({ tracks }: { tracks: readonly HealthTrackRef[] }) {
  return (
    <ul className={styles.issues}>
      {tracks.map((t) => (
        <li key={t.trackId}>
          {t.album ? (
            <Link to={`/albums/${t.album.id}`}>{t.title ?? 'Untitled'}</Link>
          ) : (
            (t.title ?? 'Untitled')
          )}
          <span className="mono"> {formatDuration(t.durationMs)}</span>
          <Path>{t.relPath}</Path>
        </li>
      ))}
    </ul>
  );
}

function Path({ children }: { children: ReactNode }) {
  return <code className={styles.path}>{children}</code>;
}

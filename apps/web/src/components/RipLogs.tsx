import type { RipLogSummary, RipVerdict } from '@sonic-archive/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import styles from './RipLogs.module.css';

export const VERDICT_LABELS: Record<RipVerdict, string> = {
  verified: 'Verified',
  clean: 'Clean rip',
  differs: 'Differs from AccurateRip',
  problems: 'Rip problems',
  unknown: 'Unverified',
};

const VERDICT_NOTES: Record<RipVerdict, string> = {
  verified: 'Matches other rips of this pressing in AccurateRip or the CUETools database.',
  clean: 'Ripped in secure mode without errors; this pressing is not in the databases.',
  differs:
    'No read errors, but AccurateRip holds other checksums: usually a different pressing with the same track layout.',
  problems: 'The ripper reported read errors or mismatched test and copy CRCs.',
  unknown: 'The log does not say enough to judge the rip.',
};

/** A small stamp for the verdict, styled per outcome. */
export function RipStamp({ verdict }: { readonly verdict: RipVerdict }) {
  return <span className={`${styles.stamp} ${styles[verdict]}`}>{VERDICT_LABELS[verdict]}</span>;
}

/** The album's rip logs, summarized, each readable in full. */
export function RipLogs({
  logs,
  verdict,
}: {
  readonly logs: readonly RipLogSummary[];
  readonly verdict: RipVerdict;
}) {
  const [open, setOpen] = useState<RipLogSummary | null>(null);
  return (
    <div className={styles.panel}>
      <p className={styles.verdict}>
        <RipStamp verdict={verdict} />
      </p>
      <p className={styles.note}>{VERDICT_NOTES[verdict]}</p>
      <ul className={styles.logs}>
        {logs.map((log) => (
          <li key={log.id}>
            <p className={styles.logHead}>
              <span className="mono">
                {log.tool}
                {log.toolVersion ? ` ${log.toolVersion}` : ''}
                {log.disc ? ` · ${log.disc}` : ''}
              </span>
              <RipStamp verdict={log.verdict} />
            </p>
            <ul className={`mono ${styles.facts}`}>
              {facts(log).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <button type="button" className={styles.read} onClick={() => setOpen(log)}>
              Read log
            </button>
          </li>
        ))}
      </ul>
      {open && <LogDialog log={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Short facts for one log, most telling first. */
export function facts(log: RipLogSummary): string[] {
  const out: string[] = [];
  const ar = log.accurateRip;
  if (ar) {
    const total = ar.accurate + ar.inaccurate + ar.notInDatabase;
    if (ar.accurate > 0 || ar.inaccurate > 0) {
      out.push(
        `AccurateRip ${ar.accurate}/${total} accurate${ar.minConfidence !== null ? ` (confidence ≥ ${ar.minConfidence})` : ''}`,
      );
    } else {
      out.push('Not in AccurateRip');
    }
  }
  if (log.ctdb) out.push(`CTDB ${log.ctdb.accurate}/${log.ctdb.tracks} accurate`);
  if (log.crcChecks > 0) {
    out.push(
      log.crcMismatches === 0
        ? 'Test & copy CRCs match'
        : `${log.crcMismatches} test/copy CRC mismatch(es)`,
    );
  }
  if (log.readProblems > 0) out.push(`${log.readProblems} read problem(s)`);
  if (log.readMode) out.push(`Mode: ${log.readMode}`);
  if (log.readOffset !== null) out.push(`Offset ${log.readOffset > 0 ? '+' : ''}${log.readOffset}`);
  if (log.drive) out.push(log.drive);
  if (log.hasChecksum) out.push('Log checksum present');
  return out;
}

function LogDialog({ log, onClose }: { log: RipLogSummary; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useQuery({
    queryKey: ['rip-log', log.id],
    queryFn: ({ signal }) => api.ripLog(log.id, signal),
  });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
    };
  }, []);
  return (
    <dialog ref={dialog} className={styles.dialog} aria-label={log.label} onClose={onClose}>
      <header className={styles.bar}>
        <p className="mono">{log.label}</p>
        <button type="button" className={styles.read} onClick={onClose}>
          Close
        </button>
      </header>
      <pre className={styles.text}>
        {text.isPending ? 'Loading…' : text.isError ? 'Could not load the log.' : text.data.text}
      </pre>
    </dialog>
  );
}

import type { ScanRecord } from '@sonic-archive/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** What a finished scan changed, in words; null when nothing did. */
export function describeScan(scan: ScanRecord): string | null {
  const parts = [
    scan.added && `${scan.added} added`,
    scan.updated && `${scan.updated} updated`,
    scan.restored && `${scan.restored} restored`,
    scan.missing && `${scan.missing} missing`,
  ].filter(Boolean);
  return parts.length > 0 ? `Library updated: ${parts.join(', ')}` : null;
}

/**
 * Follows `/api/events`: when a scan finishes with changes (the `start:watch`
 * watcher, or a scan run by hand), every page's data is refetched and a
 * short notice is returned for display.
 */
export function useLibraryEvents(): string | null {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    let seen: number | null = null;
    source.addEventListener('scan', (event) => {
      const scan = JSON.parse((event as MessageEvent<string>).data) as ScanRecord;
      // The first event is the scan the page was loaded after.
      if (seen === null || scan.id === seen) {
        seen = scan.id;
        return;
      }
      seen = scan.id;
      const text = describeScan(scan);
      if (text === null) return;
      void queryClient.invalidateQueries();
      setNotice(text);
    });
    return () => source.close();
  }, [queryClient]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  return notice;
}

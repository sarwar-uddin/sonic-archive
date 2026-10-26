import type { LibraryStatus, ScanRecord } from '@sonic-archive/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api.ts';

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
      const scan = JSON.parse((event as MessageEvent<string>).data) as ScanRecord | null;
      // The first event is the scan the page was loaded after, or null on a
      // new install (so the first scan ever is news).
      if (scan === null) {
        seen = 0;
        return;
      }
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
    // Live status (scan progress, a newly chosen folder) for the progress
    // strip, the setup screen and settings.
    source.addEventListener('library', (event) => {
      const status = JSON.parse((event as MessageEvent<string>).data) as LibraryStatus;
      const previous = queryClient.getQueryData<LibraryStatus>(['library']);
      queryClient.setQueryData(['library'], status);
      if (previous && previous.root !== status.root) void queryClient.invalidateQueries();
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

/** The music folder and what the app is doing with it, kept live by the events stream. */
export function useLibraryStatus() {
  return useQuery({
    queryKey: ['library'],
    queryFn: ({ signal }) => api.library(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

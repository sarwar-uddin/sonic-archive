/**
 * Pure rules behind the library health report, kept free of SQL so each can
 * be unit-tested with hand-built rows.
 */
import { albumFolder } from '../metadata/map.ts';
import { nameKey } from '../text/normalize.ts';

export interface TrackFacts {
  readonly trackId: number;
  readonly albumId: number | null;
  readonly groupKey: string | null;
  readonly title: string | null;
  readonly displayArtist: string | null;
  readonly creditCount: number;
  readonly trackNo: number | null;
  readonly discNo: number | null;
  readonly year: number | null;
  readonly durationMs: number | null;
  readonly relPath: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Problems per album, in a stable order; albums without problems are omitted. */
export function albumMetadataIssues(tracks: readonly TrackFacts[]): Map<number, string[]> {
  const byAlbum = new Map<number, TrackFacts[]>();
  for (const track of tracks) {
    if (track.albumId === null) continue;
    const list = byAlbum.get(track.albumId) ?? [];
    list.push(track);
    byAlbum.set(track.albumId, list);
  }

  const out = new Map<number, string[]>();
  for (const [albumId, list] of byAlbum) {
    const issues: string[] = [];
    if (list[0]?.groupKey?.startsWith('dir:')) issues.push('No album tag: grouped by folder');
    const untitled = list.filter((t) => t.title === null).length;
    if (untitled > 0) issues.push(`${plural(untitled, 'track')} without a title`);
    const noArtist = list.filter((t) => t.displayArtist === null && t.creditCount === 0).length;
    if (noArtist > 0) issues.push(`${plural(noArtist, 'track')} without an artist`);
    const unnumbered = list.filter((t) => t.trackNo === null).length;
    if (unnumbered > 0) issues.push(`${plural(unnumbered, 'track')} without a track number`);
    if (list.every((t) => t.year === null)) issues.push('No year');
    issues.push(...numberingProblems(list));
    if (issues.length > 0) out.set(albumId, issues);
  }
  return out;
}

/** Gaps and repeats in track numbers, per disc. */
export function numberingProblems(tracks: readonly TrackFacts[]): string[] {
  const discs = new Map<number | null, number[]>();
  for (const t of tracks) {
    if (t.trackNo === null) continue;
    const list = discs.get(t.discNo) ?? [];
    list.push(t.trackNo);
    discs.set(t.discNo, list);
  }
  const problems: string[] = [];
  const label = (disc: number | null) =>
    discs.size > 1 && disc !== null ? ` on disc ${disc}` : '';
  for (const [disc, numbers] of [...discs].sort(([a], [b]) => (a ?? 0) - (b ?? 0))) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const repeated = [...new Set(sorted.filter((n, i) => sorted[i - 1] === n))];
    if (repeated.length > 0)
      problems.push(`Repeated track number ${repeated.join(', ')}${label(disc)}`);
    const max = sorted.at(-1) ?? 0;
    const present = new Set(sorted);
    const missing: number[] = [];
    for (let n = 1; n <= max; n++) if (!present.has(n)) missing.push(n);
    if (missing.length > 0) {
      const shown =
        missing.length > 6 ? `${missing.slice(0, 6).join(', ')}, …` : missing.join(', ');
      problems.push(`Missing track ${shown}${label(disc)}`);
    }
  }
  return problems;
}

/**
 * Same normalized artist and title, durations within `toleranceMs`. Groups
 * are chained: A~B and B~C put A, B, C together. `exclude` drops groups made
 * up entirely of one exact-duplicate set (they are reported separately).
 */
export function probableDuplicates<T extends TrackFacts>(
  tracks: readonly T[],
  toleranceMs = 2000,
  isSameExactSet: (group: readonly T[]) => boolean = () => false,
): T[][] {
  const buckets = new Map<string, T[]>();
  for (const t of tracks) {
    if (t.title === null || t.displayArtist === null || t.durationMs === null) continue;
    const key = `${nameKey(t.displayArtist)}\u0000${nameKey(t.title)}`;
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }
  const groups: T[][] = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0));
    let current: T[] = [];
    for (const t of sorted) {
      const prev = current.at(-1);
      if (prev && (t.durationMs ?? 0) - (prev.durationMs ?? 0) > toleranceMs) {
        if (current.length > 1) groups.push(current);
        current = [];
      }
      current.push(t);
    }
    if (current.length > 1) groups.push(current);
  }
  return groups.filter((g) => !isSameExactSet(g));
}

/**
 * Albums whose tracks sit in unrelated folders. Disc folders (CD1, Disc 2)
 * are folded into their album folder first, so a normal multi-disc rip is
 * not reported.
 */
export function splitAlbumFolders(tracks: readonly TrackFacts[]): Map<number, string[]> {
  const folders = new Map<number, Set<string>>();
  for (const t of tracks) {
    if (t.albumId === null) continue;
    const set = folders.get(t.albumId) ?? new Set<string>();
    set.add(albumFolder(t.relPath));
    folders.set(t.albumId, set);
  }
  const out = new Map<number, string[]>();
  for (const [albumId, set] of folders) if (set.size > 1) out.set(albumId, [...set].sort());
  return out;
}

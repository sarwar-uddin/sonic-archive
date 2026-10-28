/**
 * The audio player: a queue of tracks and one <audio> element, outside React
 * so playback survives navigation. Components read it through `usePlayer`.
 *
 * Tracks cut from a single-file CD image are spans of one file. When the
 * next track continues the same file, the element simply keeps playing and
 * only the "current track" moves on: whole-album playback of a CD image is
 * gapless, exactly as the disc plays.
 */
import type { TrackSummary } from '@sonic-archive/contracts';
import { artworkUrl } from './api.ts';

export interface QueueItem {
  readonly trackId: number;
  readonly title: string;
  readonly artist: string | null;
  readonly albumId: number | null;
  readonly albumTitle: string | null;
  readonly artworkId: number | null;
  readonly fileId: number;
  readonly playback: 'direct' | 'transcode';
  /** Span inside the file; a whole file is 0..null. */
  readonly startMs: number;
  readonly endMs: number | null;
  readonly durationMs: number | null;
}

export interface PlayerState {
  readonly queue: readonly QueueItem[];
  readonly index: number;
  readonly playing: boolean;
  /** Position within the current track. */
  readonly positionMs: number;
  readonly volume: number;
  /** The current track could not be loaded or decoded. */
  readonly failed: boolean;
}

export function toQueueItem(
  track: TrackSummary,
  album: { id: number; title: string; artworkId: number | null } | null,
): QueueItem {
  return {
    trackId: track.id,
    title: track.title ?? track.file.relPath.split('/').at(-1) ?? 'Untitled',
    artist: track.displayArtist,
    albumId: album?.id ?? null,
    albumTitle: album?.title ?? null,
    artworkId: album?.artworkId ?? null,
    fileId: track.file.id,
    playback: track.file.playback,
    startMs: track.span?.startMs ?? 0,
    endMs: track.span?.endMs ?? null,
    durationMs: track.durationMs,
  };
}

export const audioUrl = (fileId: number, startSeconds?: number) =>
  `/api/files/${fileId}/audio${startSeconds ? `?start=${startSeconds.toFixed(3)}` : ''}`;

/** Whether `next` continues `current` in the same file, with no gap. */
export function continues(current: QueueItem, next: QueueItem | undefined): boolean {
  return next !== undefined && next.fileId === current.fileId && next.startMs === current.endMs;
}

export interface Player {
  getState(): PlayerState;
  subscribe(listener: () => void): () => void;
  play(queue: readonly QueueItem[], index: number): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(positionMs: number): void;
  setVolume(volume: number): void;
}

export function createPlayer(audio: HTMLAudioElement): Player {
  let state: PlayerState = {
    queue: [],
    index: 0,
    playing: false,
    positionMs: 0,
    volume: 1,
    failed: false,
  };
  const listeners = new Set<() => void>();
  // Where the loaded stream starts within its file, in seconds: 0 for a
  // file sent as stored; the requested start for a converted stream.
  let streamOffset = 0;
  let loadedFile: number | null = null;
  let frame = 0;

  const set = (patch: Partial<PlayerState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const current = () => state.queue[state.index];
  const fileMs = () => (streamOffset + audio.currentTime) * 1000;

  const start = () => {
    audio.play()?.catch(() => set({ playing: false }));
  };

  /** Loads `item` at `atMs` into the track, reusing the open file when possible. */
  const load = (item: QueueItem, atMs: number) => {
    const targetSeconds = (item.startMs + atMs) / 1000;
    if (state.failed) {
      // Try the file afresh: the element keeps its error until a new load.
      set({ failed: false });
      loadedFile = null;
    }
    if (item.playback === 'direct') {
      if (loadedFile !== item.fileId) {
        audio.src = audioUrl(item.fileId);
        loadedFile = item.fileId;
        streamOffset = 0;
      }
      audio.currentTime = targetSeconds;
    } else {
      // A converted stream cannot seek: ask for one that starts there.
      audio.src = audioUrl(item.fileId, targetSeconds);
      loadedFile = item.fileId;
      streamOffset = targetSeconds;
    }
    updateMediaSession(item);
    start();
  };

  const advance = () => {
    const item = current();
    const next = state.queue[state.index + 1];
    if (!item || !next) {
      audio.pause();
      set({ playing: false, positionMs: 0 });
      return;
    }
    if (continues(item, next) && !audio.ended) {
      // Same file, next span: keep playing, just move the marker.
      set({ index: state.index + 1, positionMs: 0 });
      updateMediaSession(next);
    } else {
      set({ index: state.index + 1, positionMs: 0 });
      load(next, 0);
    }
  };

  // Spans end mid-file, so the end is watched every frame while playing;
  // `timeupdate` (about 4 per second) would overshoot into the next song.
  const watch = () => {
    cancelAnimationFrame(frame);
    const tick = () => {
      const item = current();
      if (item && !audio.paused) {
        const at = fileMs();
        if (item.endMs !== null && at >= item.endMs) advance();
        else set({ positionMs: Math.max(0, at - item.startMs) });
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
  };

  audio.addEventListener('play', () => {
    set({ playing: true });
    watch();
  });
  audio.addEventListener('pause', () => set({ playing: false }));
  audio.addEventListener('ended', advance);
  // A stream that cannot be fetched or decoded (a converted format without
  // ffmpeg, a damaged file): stop here and say so, rather than skip ahead.
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    cancelAnimationFrame(frame);
    set({ playing: false, failed: true });
  });

  function updateMediaSession(item: QueueItem) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.artist ?? '',
      album: item.albumTitle ?? '',
      artwork:
        item.artworkId === null
          ? []
          : [
              { src: artworkUrl(item.artworkId, 'sm'), sizes: '400x400', type: 'image/webp' },
              { src: artworkUrl(item.artworkId, 'lg'), sizes: '1200x1200', type: 'image/webp' },
            ],
    });
  }

  const player: Player = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play(queue, index) {
      const item = queue[index];
      if (!item) return;
      set({ queue, index, positionMs: 0 });
      load(item, 0);
    },
    toggle() {
      const item = current();
      if (!item) return;
      if (state.failed) load(item, state.positionMs);
      else if (audio.paused) start();
      else audio.pause();
    },
    next() {
      const next = state.queue[state.index + 1];
      if (!next) return;
      set({ index: state.index + 1, positionMs: 0 });
      load(next, 0);
    },
    previous() {
      const item = current();
      if (!item) return;
      // Like a CD player: back to the start first, then the track before.
      const before = state.queue[state.index - 1];
      if (state.positionMs > 3000 || !before) {
        load(item, 0);
        set({ positionMs: 0 });
      } else {
        set({ index: state.index - 1, positionMs: 0 });
        load(before, 0);
      }
    },
    seek(positionMs) {
      const item = current();
      if (!item) return;
      const length = item.durationMs ?? Number.POSITIVE_INFINITY;
      const clamped = Math.max(0, Math.min(positionMs, length - 250));
      load(item, clamped);
      set({ positionMs: clamped });
    },
    setVolume(volume) {
      audio.volume = Math.max(0, Math.min(1, volume));
      set({ volume: audio.volume });
    },
  };

  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    const session = navigator.mediaSession;
    session.setActionHandler?.('play', () => player.toggle());
    session.setActionHandler?.('pause', () => player.toggle());
    session.setActionHandler?.('nexttrack', () => player.next());
    session.setActionHandler?.('previoustrack', () => player.previous());
    session.setActionHandler?.('seekto', (details) => {
      if (details.seekTime !== undefined) player.seek(details.seekTime * 1000);
    });
  }
  return player;
}

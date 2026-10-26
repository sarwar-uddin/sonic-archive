/** Formatting for durations, sizes, and audio specifications. Pure functions. */

/** 61_000 → "1:01"; 3_725_000 → "1:02:05". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Long spans for totals: "46 min", "3 h 12 min", "4 days 2 h". */
export function formatLongDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days ${hours % 24} h`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** 44100 → "44.1"; 96000 → "96"; 2822400 → "2822.4". */
export function formatKhz(sampleRate: number): string {
  return String(Math.round(sampleRate / 100) / 10);
}

/** 44100 → "44.1 kHz". */
export function formatSampleRate(sampleRate: number | null | undefined): string {
  return sampleRate ? `${formatKhz(sampleRate)} kHz` : '—';
}

/**
 * Compact resolution in the record-collector convention: "24/96", "16/44.1".
 * Lossy tracks have no bit depth, so they show the sample rate alone.
 */
export function formatResolution(
  bitDepth: number | null | undefined,
  sampleRate: number | null | undefined,
): string {
  if (!sampleRate) return '—';
  return bitDepth ? `${bitDepth}/${formatKhz(sampleRate)}` : `${formatKhz(sampleRate)} kHz`;
}

/** True for anything beyond CD quality (16-bit / 44.1–48 kHz). */
export function isHiRes(
  bitDepth: number | null | undefined,
  sampleRate: number | null | undefined,
) {
  return (bitDepth ?? 0) > 16 || (sampleRate ?? 0) > 48_000;
}

export function formatChannels(channels: number | null | undefined): string {
  if (!channels) return '—';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels} ch`;
}

export function formatBitrate(bitrate: number | null | undefined): string {
  return bitrate ? `${Math.round(bitrate / 1000).toLocaleString('en')} kbps` : '—';
}

/** "FLAC · 24 bit / 96 kHz · Stereo" */
export function formatSpec(spec: {
  codec: string | null;
  bitDepth: number | null;
  sampleRate: number | null;
  channels?: number | null;
}): string {
  const parts = [shortCodec(spec.codec)];
  if (spec.sampleRate) {
    parts.push(
      spec.bitDepth
        ? `${spec.bitDepth} bit / ${formatSampleRate(spec.sampleRate)}`
        : formatSampleRate(spec.sampleRate),
    );
  }
  if (spec.channels) parts.push(formatChannels(spec.channels));
  return parts.filter(Boolean).join(' · ');
}

/** Friendlier names for parser codec strings. */
export function shortCodec(codec: string | null | undefined): string {
  if (!codec) return '—';
  if (/^MPEG 1 Layer 3$/i.test(codec) || /^MP3$/i.test(codec)) return 'MP3';
  if (/^PCM$/i.test(codec)) return 'PCM';
  return codec;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en')} ${count === 1 ? one : many}`;
}

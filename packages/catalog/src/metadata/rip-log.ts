/**
 * Reads the logs CD rippers write next to a rip: Exact Audio Copy (EAC),
 * X Lossless Decoder (XLD) and CUETools (.accurip). Pure: takes the text,
 * returns what it says about how trustworthy the rip is.
 *
 * English, Russian and Spanish EAC logs are understood (all occur in the
 * collection this was built for). Anything unrecognized gives an `unknown` verdict
 * rather than a wrong one.
 */

import path from 'node:path';
import type { RipVerdict } from '@sonic-archive/contracts';
import { isDiscFolder } from './map.ts';

export type { RipVerdict };

export type RipTool = 'EAC' | 'XLD' | 'CUETools' | 'other';

export interface RipLogReport {
  readonly tool: RipTool;
  readonly toolVersion: string | null;
  readonly drive: string | null;
  readonly readMode: string | null;
  readonly secureMode: boolean | null;
  readonly readOffset: number | null;
  /** Tracks (or ranges) ripped twice whose CRCs were compared. */
  readonly crcChecks: number;
  readonly crcMismatches: number;
  /** Reported read problems: suspicious positions, timing problems, damaged sectors… */
  readonly readProblems: number;
  readonly accurateRip: {
    readonly accurate: number;
    readonly inaccurate: number;
    readonly notInDatabase: number;
    /** The weakest matching track's confidence: how many other rips agree. */
    readonly minConfidence: number | null;
  } | null;
  readonly ctdb: { readonly tracks: number; readonly accurate: number } | null;
  /** EAC/XLD append a checksum that shows the log was not edited afterwards. */
  readonly hasChecksum: boolean;
  readonly verdict: RipVerdict;
}

type ArStatus = { status: 'accurate' | 'inaccurate' | 'absent'; confidence: number | null };

/**
 * Log text from its bytes. EAC writes UTF-16 with a byte-order mark; XLD and
 * CUETools write UTF-8; very old logs may be Windows-1251 or -1252.
 */
export function decodeLogBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Old Russian EAC versions wrote Windows-1251.
    const cyrillic = new TextDecoder('windows-1251').decode(bytes);
    if (/Дисковод|Режим чтения|Отчёт EAC|Отчет EAC/.test(cyrillic)) return cyrillic;
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function parseRipLog(text: string): RipLogReport {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim());
  const first = lines.find((l) => l !== '') ?? '';

  const tool: RipTool = /^Exact Audio Copy|^EAC extraction logfile/i.test(first)
    ? 'EAC'
    : /^X Lossless Decoder/i.test(first)
      ? 'XLD'
      : /^\[CUETools log/i.test(first)
        ? 'CUETools'
        : 'other';
  const toolVersion =
    /^Exact Audio Copy (V[\w. ]+?) from/i.exec(first)?.[1]?.trim() ??
    /^X Lossless Decoder version (\S+)/i.exec(first)?.[1] ??
    /Version:\s*([\d.]+)/i.exec(first)?.[1] ??
    null;

  const field = (pattern: RegExp) => {
    for (const line of lines) {
      const match = pattern.exec(line);
      if (match) return (match[1] ?? '').trim();
    }
    return null;
  };
  const drive = field(/^(?:Used drive|Дисковод|Usar unidad)\s*:\s*(.+?)(?:\s+Adapter:.*)?$/i);
  const readMode = field(/^(?:Read mode|Ripper mode|Режим чтения|Modo de Lectura)\s*:\s*(.+)$/i);
  const offset = field(
    /^(?:Read offset correction|Коррекция смещения при чтении|Corrección de Desplazamiento de Lectura)\s*:\s*(-?\d+)/i,
  );
  // Russian and Spanish EAC call secure mode "Достоверность" and "Seguro".
  const secureMode =
    readMode === null
      ? null
      : /secure|paranoi|достоверн|seguro/i.test(readMode) && !/burst/i.test(readMode);

  // Test and copy CRCs, paired in order of appearance.
  let crcChecks = 0;
  let crcMismatches = 0;
  let pendingTest: string | null = null;
  for (const line of lines) {
    const test = /^(?:Test CRC|CRC теста|CRC32 hash \(test run\)\s*:)\s*([0-9A-F]{8})/i.exec(line);
    const copy = /^(?:Copy CRC|Copiar CRC|CRC копии|CRC32 hash\s*:)\s*([0-9A-F]{8})/i.exec(line);
    if (test) pendingTest = (test[1] as string).toUpperCase();
    else if (copy && pendingTest !== null) {
      crcChecks++;
      if ((copy[1] as string).toUpperCase() !== pendingTest) crcMismatches++;
      pendingTest = null;
    }
  }

  let readProblems = 0;
  for (const line of lines) {
    if (
      /^(Suspicious position|Timing problem|Missing samples|Подозрительная позиция|Posición sospechosa)/i.test(
        line,
      )
    ) {
      readProblems++;
    }
    const xld = /^(Read error|Damaged sector count|Skipped \(treated as error\))\s*:\s*(\d+)/i.exec(
      line,
    );
    if (xld && Number(xld[2]) > 0) readProblems++;
  }
  // EAC's own verdict, for problems logged in forms not matched above.
  const eacErrors = lines.some((l) =>
    /^(There were errors|Произошли ошибки|Были ошибки|Hubo errores)/i.test(l),
  );

  const accurateRip = readAccurateRip(lines);
  const ctdb = readCtdb(lines);
  const hasChecksum = lines.some((l) =>
    /^==== (Log checksum|Контрольная сумма)|^-----BEGIN XLD SIGNATURE/i.test(l),
  );

  const problems = readProblems > 0 || crcMismatches > 0 || eacErrors;
  const arVerified =
    accurateRip !== null &&
    accurateRip.accurate > 0 &&
    accurateRip.inaccurate === 0 &&
    accurateRip.notInDatabase === 0;
  const ctdbVerified = ctdb !== null && ctdb.tracks > 0 && ctdb.accurate === ctdb.tracks;
  // The CUETools database knows more pressings than AccurateRip, so a full
  // match there outweighs AccurateRip disagreeing.
  const verdict: RipVerdict = problems
    ? 'problems'
    : arVerified || ctdbVerified
      ? 'verified'
      : (accurateRip?.inaccurate ?? 0) > 0
        ? 'differs'
        : secureMode
          ? 'clean'
          : 'unknown';

  return {
    tool,
    toolVersion,
    drive,
    readMode,
    secureMode,
    readOffset: offset === null ? null : Number(offset),
    crcChecks,
    crcMismatches,
    readProblems,
    accurateRip,
    ctdb,
    hasChecksum,
    verdict,
  };
}

/**
 * AccurateRip results per track. Logs repeat them (EAC: per track and in a
 * summary; XLD: in a summary, sometimes twice, and per track), so results
 * are keyed by track number and each track counts once.
 */
function readAccurateRip(lines: readonly string[]): RipLogReport['accurateRip'] {
  const tracks = new Map<number, ArStatus>();
  let current: number | null = null;
  let wholeDiscAbsent = false;

  // The first result for a track wins: later ones are repeats, or (CUETools)
  // matches at other offsets, which say nothing about this rip.
  const record = (track: number, status: ArStatus) => {
    if (!tracks.has(track)) tracks.set(track, status);
  };
  for (const line of lines) {
    if (/^Offsetted by/i.test(line)) break;
    const block = /^(?:Track|Трек|Pista)\s+(\d+)\s*$/i.exec(line);
    if (block) {
      current = Number(block[1]);
      continue;
    }
    // EAC summary: "Track  3  accurately ripped (confidence 200)  [663AD2EE]",
    // Russian "Трек  1  : извлечено точно (доверие 136)".
    const eac =
      /^(?:Track|Трек|Pista)\s+(\d+)\s*:?\s+(accurately ripped|not present|cannot be verified|извлечено точно|точное извлечение|отсутствует|нет в базе|не может|extraída con precisión|no está presente|no se puede verificar)/i.exec(
        line,
      );
    // XLD summary: "Track 03 : OK (v1+v2, confidence 378/664)", "NG", "Not Found"
    const xld = /^Track\s+(\d+)\s*:\s*(OK|NG|Not Found)\b/i.exec(line);
    // CUETools: " 01     [64ecdb9f|22ba4f84] (143+133/492) Accurately ripped"
    const cue =
      /^(\d+)\s+\[[0-9a-f|]+\]\s+\((\d+)(?:\+(\d+))?\/\d+\)\s+(Accurately ripped|Differs|No match)/i.exec(
        line,
      );
    const summary = eac ?? xld;
    if (summary) {
      const word = (summary[2] ?? '').toLowerCase();
      record(Number(summary[1]), {
        status:
          word.startsWith('accurately') ||
          word === 'ok' ||
          /^(извлечено|точное|extraída)/.test(word)
            ? 'accurate'
            : /^(not |отсутствует|нет|no está)/.test(word)
              ? 'absent'
              : 'inaccurate',
        confidence: confidenceIn(line),
      });
      continue;
    }
    if (cue) {
      record(Number(cue[1]), {
        status: /^accurately/i.test(cue[4] as string) ? 'accurate' : 'inaccurate',
        confidence: Number(cue[2]) + Number(cue[3] ?? 0),
      });
      continue;
    }
    if (
      /disk not present in database|not present in the AccurateRip database/i.test(line) &&
      current === null
    ) {
      wholeDiscAbsent = true;
    }
    if (current === null || tracks.has(current)) continue;
    // Inside a track block (older EAC, XLD).
    if (/accurately ripped|извлечено точно/i.test(line)) {
      record(current, { status: 'accurate', confidence: confidenceIn(line) });
    } else if (/not present in (the )?AccurateRip database/i.test(line)) {
      record(current, { status: 'absent', confidence: null });
    } else if (/cannot be verified as accurate|may not be accurate/i.test(line)) {
      record(current, { status: 'inaccurate', confidence: confidenceIn(line) });
    }
  }

  if (tracks.size === 0) {
    return wholeDiscAbsent
      ? { accurate: 0, inaccurate: 0, notInDatabase: 1, minConfidence: null }
      : null;
  }
  const all = [...tracks.values()];
  const confidences = all
    .filter((t) => t.status === 'accurate' && t.confidence !== null)
    .map((t) => t.confidence as number);
  return {
    accurate: all.filter((t) => t.status === 'accurate').length,
    inaccurate: all.filter((t) => t.status === 'inaccurate').length,
    notInDatabase: all.filter((t) => t.status === 'absent').length,
    minConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
  };
}

/** "confidence 200" → 200; XLD's "confidence 177+200/663" → 377. */
function confidenceIn(line: string): number | null {
  const match = /(?:confidence|доверие|confianza)\s+(\d+)(?:\+(\d+))?/i.exec(line);
  return match ? Number(match[1]) + Number(match[2] ?? 0) : null;
}

/** CUETools database: "  3   | (1286/1290) Accurately ripped". */
function readCtdb(lines: readonly string[]): RipLogReport['ctdb'] {
  const tracks = new Map<number, boolean>();
  for (const line of lines) {
    const match = /^(\d+)\s*\|\s*\(\d+\/\d+\)\s*(Accurately ripped|Differs|No match)/i.exec(line);
    if (match) tracks.set(Number(match[1]), /^accurately/i.test(match[2] as string));
  }
  if (tracks.size === 0) return null;
  return { tracks: tracks.size, accurate: [...tracks.values()].filter(Boolean).length };
}

/** Best evidence first: a verified log outweighs a merely clean one. */
const STRENGTH: Record<RipVerdict, number> = {
  verified: 4,
  clean: 3,
  differs: 2,
  problems: 1,
  unknown: 0,
};

/** The disc folder a log belongs to ("CD2"), or null for the whole album. */
export function logDisc(relPath: string): string | null {
  const parts = path.dirname(relPath).split(path.sep);
  return parts.find((p) => isDiscFolder(p)) ?? null;
}

/**
 * One verdict for an album from all its logs. Logs of the same disc are
 * evidence about the same rip, so the strongest one counts (an EAC log that
 * found nothing in AccurateRip plus a later CUETools check that matched is
 * verified). Across discs the weakest counts. Logs with nothing to say
 * (`unknown`) are ignored unless there is nothing else.
 */
export function albumRipVerdict(
  logs: readonly { readonly relPath: string; readonly verdict: RipVerdict }[],
): RipVerdict | null {
  if (logs.length === 0) return null;
  const byDisc = new Map<string, RipVerdict>();
  for (const log of logs) {
    const disc = logDisc(log.relPath) ?? '';
    const best = byDisc.get(disc);
    if (best === undefined || STRENGTH[log.verdict] > STRENGTH[best]) byDisc.set(disc, log.verdict);
  }
  const known = [...byDisc.values()].filter((v) => v !== 'unknown');
  if (known.length === 0) return 'unknown';
  return known.reduce((worst, v) => (STRENGTH[v] < STRENGTH[worst] ? v : worst));
}

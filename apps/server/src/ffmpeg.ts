import { spawn } from 'node:child_process';

/**
 * Whether `command` runs (`ffmpeg -version` exits 0). ffmpeg is optional:
 * without it the app still catalogs and plays what browsers can decode, but
 * cannot measure dynamic range or convert ALAC, APE, WavPack, DSD and AIFF.
 */
export function findFfmpeg(command = 'ffmpeg'): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['-version'], { stdio: 'ignore', shell: false });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

/** True for the error a spawn reports when the program is not installed. */
export function isMissingCommand(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export const FFMPEG_MISSING =
  'ffmpeg not found on PATH: dynamic range and playing ALAC, APE, WavPack, DSD and AIFF are off.';

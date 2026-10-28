import { describe, expect, it } from 'vitest';
import { findFfmpeg, isMissingCommand } from './ffmpeg.ts';

describe('findFfmpeg', () => {
  it('is false when the command is not installed', async () => {
    expect(await findFfmpeg('sonic-archive-no-such-command')).toBe(false);
  });

  it('is true when the command runs and exits cleanly', async () => {
    expect(await findFfmpeg('true')).toBe(true);
  });

  it('is false when the command fails', async () => {
    expect(await findFfmpeg('false')).toBe(false);
  });
});

describe('isMissingCommand', () => {
  it('recognizes the error of a spawn that found no program', () => {
    expect(isMissingCommand(Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }))).toBe(
      true,
    );
    expect(isMissingCommand(new Error('exited with 1'))).toBe(false);
    expect(isMissingCommand(null)).toBe(false);
  });
});

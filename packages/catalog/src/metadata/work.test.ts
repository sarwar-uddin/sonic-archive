import { describe, expect, it } from 'vitest';
import { workKey } from './work.ts';

describe('workKey', () => {
  it('matches pressings whose titles differ only by edition details', () => {
    const key = workKey('Metallica', 'Master Of Puppets');
    expect(workKey('METALLICA', 'Master of Puppets (Remastered)')).toBe(key);
    expect(workKey('Metallica', 'Master Of Puppets [Deluxe Edition]')).toBe(key);
    expect(workKey('Metallica', 'Master Of Puppets - 30th Anniversary')).toBe(key);
  });

  it('keeps different albums and artists apart', () => {
    expect(workKey('Metallica', 'Ride The Lightning')).not.toBe(
      workKey('Metallica', 'Kill Em All'),
    );
    expect(workKey('Opeth', 'Damnation')).not.toBe(workKey('Other', 'Damnation'));
    expect(workKey('Sigur Rós', 'Ágætis byrjun')).toBe(workKey('Sigur Ros', 'agætis byrjun'));
  });

  it('declines to match albums without an artist or a real title', () => {
    expect(workKey(null, 'Untagged')).toBeNull();
    expect(workKey('Band', '(Remastered)')).toBeNull();
  });
});

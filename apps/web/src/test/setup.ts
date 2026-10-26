import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no media playback; the player only needs these to resolve.
HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
  this.dispatchEvent(new Event('play'));
  return Promise.resolve();
});
HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
  this.dispatchEvent(new Event('pause'));
});

afterEach(() => {
  cleanup();
});

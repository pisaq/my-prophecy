import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACKPAD_PORT, trackpadStart } from './trackpadApi.js';

afterEach(() => vi.unstubAllGlobals());

describe('trackpad companion API', () => {
  it('recognises the companion port (and its old misspelling)', () => {
    expect(TRACKPAD_PORT.test('my-prophecy Trackpad')).toBe(true);
    expect(TRACKPAD_PORT.test('my-phophecy Trackpad')).toBe(true);
    expect(TRACKPAD_PORT.test('MidiLink Mini')).toBe(false);
  });

  it('starts capture without a second output, so notes are not doubled', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ running: true }) }));
    vi.stubGlobal('fetch', fetch);
    await trackpadStart();
    const [, options] = fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ out: '' });
  });
});

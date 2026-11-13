import { describe, expect, it } from 'vitest';
import { noteFromXY } from './trackpad.js';

const LOW_C = 36;
const HIGH_C = 96;

describe('noteFromXY (pitch pad)', () => {
  it('maps the corners: bottom-left is the lowest C, top-right the highest', () => {
    expect(noteFromXY(0, 1)).toBe(LOW_C);
    expect(noteFromXY(1, 0)).toBe(HIGH_C);
  });

  it('is the middle note in the centre', () => {
    expect(noteFromXY(0.5, 0.5)).toBe((LOW_C + HIGH_C) / 2);
  });

  it('rises to the right and towards the top', () => {
    expect(noteFromXY(0.8, 0.5)).toBeGreaterThan(noteFromXY(0.2, 0.5));
    expect(noteFromXY(0.5, 0.2)).toBeGreaterThan(noteFromXY(0.5, 0.8));
  });

  it('always returns a whole MIDI note inside the range', () => {
    for (let x = 0; x <= 1; x += 0.1) {
      for (let y = 0; y <= 1; y += 0.1) {
        const n = noteFromXY(x, y);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(LOW_C);
        expect(n).toBeLessThanOrEqual(HIGH_C);
      }
    }
  });
});
